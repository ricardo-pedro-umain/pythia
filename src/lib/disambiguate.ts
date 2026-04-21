// Pure helpers for the company disambiguation flow. Extracted from the route
// handler so they're unit-testable without standing up Next.js or Tavily.
//
// Two concerns live here:
//   1. String/domain heuristics — normalising names, extracting root domains,
//      judging whether two candidate names refer to the same entity.
//   2. The orchestration in `disambiguateCompany()` that wires those
//      heuristics to Tavily, dedupes by domain, and applies the confidence
//      gates that decide whether disambiguation is actually needed.

import { tavily } from "@tavily/core";
import { env } from "@/lib/env";

export interface CompanyCandidate {
  name: string;
  description: string;
  website: string;
  country?: string;
}

// Domains we should not treat as a company's own website
export const GENERIC_DOMAINS = new Set([
  "linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com",
  "youtube.com", "tiktok.com", "reddit.com", "github.com", "stackoverflow.com",
  "crunchbase.com", "wikipedia.org", "bloomberg.com", "techcrunch.com",
  "forbes.com", "reuters.com", "wsj.com", "ft.com", "businesswire.com",
  "prnewswire.com", "pitchbook.com", "owler.com", "zoominfo.com",
  "glassdoor.com", "indeed.com", "angellist.com", "wellfound.com",
  "g2.com", "capterra.com", "trustpilot.com", "ycombinator.com",
  "producthunt.com", "medium.com", "substack.com", "wired.com",
  "theverge.com", "venturebeat.com", "inc.com", "entrepreneur.com",
]);

export function getRootDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    const twoPartTld =
      parts.length > 2 &&
      ["co", "com", "net", "org", "gov", "edu"].includes(parts[parts.length - 2]);
    return twoPartTld ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
  } catch {
    return url;
  }
}

/** Extract the pre-TLD base of a root domain, e.g. "tesla" from "tesla.com". */
export function getDomainBase(rootDomain: string): string {
  const parts = rootDomain.split(".");
  return parts.length > 0 ? parts[0].toLowerCase() : rootDomain.toLowerCase();
}

/**
 * A domain "belongs" to the search term when its base name meaningfully
 * overlaps with the query — either direction prefix match. This filters out
 * reference sites (britannica.com, ebsco.com) that happen to host a page
 * about the company.
 */
export function domainMatchesTerm(rootDomain: string, term: string): boolean {
  const base = getDomainBase(rootDomain);
  const t = norm(term);
  if (!base || !t) return false;
  return base.startsWith(t) || t.startsWith(base);
}

/** Strip boilerplate from page titles to get a company name. */
export function titleToName(title: string): string {
  return title
    .replace(/\s*[\|–—\-:]\s*.*/u, "")
    .replace(/\s*(official\s+)?home\s*page\s*/gi, "")
    .replace(/\s*about\s+us\s*/gi, "")
    .replace(/\s*welcome\s+to\s*/gi, "")
    .trim();
}

/** Normalize a name for similarity comparison. */
export function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const GENERIC_SUFFIXES = new Set([
  "corp", "inc", "ltd", "llc", "co", "company", "group",
  "technologies", "technology", "tech", "labs", "studio", "studios",
  "solutions", "services", "consulting", "agency",
]);

/**
 * Return true when names are so close that they almost certainly refer to the
 * same entity — e.g. "xAI" vs "xAI Corp" vs "xAI Company".
 *
 * We do NOT treat "Salt" and "Salt AI" as the same; the extra token "ai" is a
 * meaningful differentiator. We check whether one normalised name is a prefix
 * of the other AND the extra suffix is just a generic company word.
 */
export function isSameCompany(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const [longer, shorter] = na.length > nb.length ? [na, nb] : [nb, na];
  if (!longer.startsWith(shorter)) return false;
  const extra = longer.slice(shorter.length);
  return GENERIC_SUFFIXES.has(extra);
}

/**
 * A candidate is only worth showing if its normalised name is a close variant
 * of the search term — not more than 2.5× its length.
 * This filters out things like "Tesla Science Center at Wardenclyffe" when the
 * user searched "Tesla", while keeping "Salt AI" when they searched "Salt".
 */
export function isCloseEnough(candidateName: string, searchName: string): boolean {
  const cn = norm(candidateName);
  const sn = norm(searchName);
  if (cn === sn) return true;
  const [longer, shorter] = cn.length > sn.length ? [cn, sn] : [sn, cn];
  return longer.startsWith(shorter) && longer.length <= shorter.length * 2.5;
}

interface ScoredResult {
  url: string;
  title: string;
  content: string;
  score: number;
}

/**
 * Run two parallel Tavily queries for a company name and decide whether the
 * user needs to disambiguate. Returns an empty list when the top result is
 * clearly dominant (e.g. "Tesla" → tesla.com wins) or when every candidate
 * resolves to the same company.
 */
export async function disambiguateCompany(
  companyName: string
): Promise<CompanyCandidate[]> {
  const trimmed = companyName.trim();
  if (!trimmed) return [];

  const client = tavily({ apiKey: env.TAVILY_API_KEY });

  const [r1, r2] = await Promise.all([
    client.search(`${trimmed} company official website`, { maxResults: 6 }),
    client.search(`"${trimmed}" company about`, { maxResults: 6 }),
  ]);

  // Merge, preserving score; deduplicate by root domain
  const byDomain = new Map<string, ScoredResult>();

  for (const result of [...r1.results, ...r2.results] as ScoredResult[]) {
    const domain = getRootDomain(result.url);
    if (GENERIC_DOMAINS.has(domain)) continue;
    // Keep highest-scoring result per domain
    if (!byDomain.has(domain) || result.score > byDomain.get(domain)!.score) {
      byDomain.set(domain, result);
    }
  }

  // Sort by score descending. Keep only domains whose base name overlaps
  // with the search term — this strips out reference/encyclopedia sites
  // like britannica.com or ebsco.com that host pages about the company
  // but are not the company itself.
  const ranked = [...byDomain.entries()]
    .filter(([domain]) => domainMatchesTerm(domain, trimmed))
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, 5);

  // If all remaining candidates share the same domain base (e.g. tesla.com
  // and tesla.info), they're the same entity — no disambiguation needed.
  if (ranked.length > 1) {
    const bases = new Set(ranked.map(([d]) => getDomainBase(d)));
    if (bases.size === 1) return [];
  }

  // ── Confidence check ───────────────────────────────────────────────────
  // Skip disambiguation only when the top result is *dominant* — i.e. it
  // scores meaningfully higher than the runner-up.  A high absolute score
  // alone is NOT sufficient: "Salt" returns salt.ch at 0.77+ because that IS
  // a very relevant result, but saltai.io is close behind.  The ratio test
  // correctly captures single-entity dominance (Tesla, SpaceX, Stripe…) while
  // letting genuinely ambiguous names through.
  const topScore = ranked.length > 0 ? ranked[0][1].score : 0;
  const secondScore = ranked.length > 1 ? ranked[1][1].score : 0;

  if (ranked.length <= 1 || (topScore >= 0.6 && topScore >= secondScore * 1.6)) {
    return [];
  }

  // Build candidate list
  const nameNorm = norm(trimmed);
  const candidates: CompanyCandidate[] = [];
  const lowered = trimmed.toLowerCase();

  for (const [domain, result] of ranked) {
    const titleLower = result.title.toLowerCase();
    const contentLower = result.content.toLowerCase();
    if (!titleLower.includes(lowered) && !contentLower.includes(lowered)) continue;
    if (result.score < 0.35) continue; // ignore very low-relevance results

    const name = titleToName(result.title) || trimmed;
    // Drop results whose extracted name is too far from the search term
    if (!isCloseEnough(name, trimmed)) continue;
    const description = result.content.slice(0, 180).replace(/\s+/g, " ").trim();
    candidates.push({ name, description, website: `https://www.${domain}` });
    if (candidates.length >= 4) break;
  }

  // If all candidates resolve to essentially the same company name, it's
  // unambiguous — e.g. "xAI", "xAI Corp", "x.AI" → all the same.
  if (candidates.length <= 1) return [];

  const allSame = candidates.every((c) => isSameCompany(c.name, candidates[0].name));
  if (allSame) return [];

  // Verify the queried name meaningfully appears in ALL candidates; drop
  // any that are clearly unrelated noise.
  const distinct = candidates.filter(
    (c) =>
      norm(c.name).includes(nameNorm) ||
      nameNorm.includes(norm(c.name).slice(0, nameNorm.length))
  );
  if (distinct.length <= 1) return [];

  return distinct;
}

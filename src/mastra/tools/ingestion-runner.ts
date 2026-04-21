import { tavily, type TavilySearchResponse } from "@tavily/core";
import { env } from "@/lib/env";
import type { RawIngestionResult, RawSource } from "@/lib/types";

const client = tavily({ apiKey: env.TAVILY_API_KEY });

// The canonical search panel. Each entry has a template (with `{c}` for the
// company name and `{y}` for the current year) and a `sourceType` used to
// tag every hit from that query so the downstream data engineer can weight
// accordingly. Using the current year keeps recency hints from going stale
// — hardcoding "2024" silently biased results toward outdated reporting
// once the calendar flipped.
const SEARCH_PLAN: Array<{ template: string; sourceType: RawSource["sourceType"] }> = [
  { template: `{c} official website about`,                      sourceType: "website"   },
  { template: `{c} funding raised valuation investors`,          sourceType: "financial" },
  { template: `{c} revenue ARR employees headcount {y}`,         sourceType: "financial" },
  { template: `{c} CEO founder leadership team`,                 sourceType: "website"   },
  { template: `{c} product launch news {y}`,                     sourceType: "news"      },
  { template: `{c} competitors market share industry`,           sourceType: "news"      },
  { template: `{c} reviews employees culture glassdoor`,         sourceType: "review"    },
  { template: `{c} crunchbase pitchbook acquisition`,            sourceType: "financial" },
];

const MAX_RESULTS_PER_QUERY = 8;
const SNIPPET_MAX_CHARS = 400;
const OVERALL_CAP = 30;

export interface SearchRunnerInput {
  companyName: string;
  inputUrl?: string | null;
  /** Extra free-form queries to add to the panel (used by the retry pass). */
  extraQueries?: string[];
}

/**
 * Run the canonical search plan against Tavily in parallel and return a
 * compact, deduplicated RawIngestionResult. Pure code — no LLM involved.
 */
export async function runIngestionSearches(
  input: SearchRunnerInput
): Promise<RawIngestionResult> {
  const { companyName, inputUrl, extraQueries = [] } = input;

  const currentYear = String(new Date().getFullYear());
  const queries = [
    ...SEARCH_PLAN.map((q) => ({
      query: q.template.replace("{c}", companyName).replace("{y}", currentYear),
      sourceType: q.sourceType,
    })),
    ...extraQueries.map((q) => ({ query: q, sourceType: "news" as const })),
  ];

  // Run in parallel; swallow individual failures so one bad query doesn't
  // take down the whole ingestion pass.
  const settled = await Promise.allSettled(
    queries.map((q) =>
      client
        .search(q.query, { maxResults: MAX_RESULTS_PER_QUERY, includeAnswer: false })
        .then((res) => ({ res: res as TavilySearchResponse, sourceType: q.sourceType }))
    )
  );

  // If every single query failed, surface the underlying error instead of
  // silently returning zero sources — that used to manifest as a ~100ms
  // ingestion step followed by an empty report with no hint of why.
  const rejections = settled.filter((s) => s.status === "rejected");
  if (rejections.length === settled.length && settled.length > 0) {
    const first = rejections[0] as PromiseRejectedResult;
    throw new Error(
      `All ${settled.length} ingestion searches failed. First error: ${
        first.reason instanceof Error ? first.reason.message : String(first.reason)
      }`
    );
  }
  if (rejections.length > 0) {
    console.warn(
      `[ingestion] ${rejections.length}/${settled.length} Tavily queries failed for "${companyName}"`
    );
  }

  // Deduplicate by URL, keep the highest-scoring hit for each.
  const byUrl = new Map<string, RawSource & { score: number }>();
  const today = new Date().toISOString().slice(0, 10);

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const r of result.value.res.results) {
      if (!r.url) continue;
      const prior = byUrl.get(r.url);
      const score = r.score ?? 0;
      if (prior && prior.score >= score) continue;

      const snippet = (r.content ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, SNIPPET_MAX_CHARS);

      byUrl.set(r.url, {
        url: r.url,
        title: r.title ?? "",
        content: snippet,
        sourceType: result.value.sourceType,
        dateAccessed: today,
        datePublished: r.publishedDate || null,
        score,
      });
    }
  }

  // Rank by score, cap to OVERALL_CAP, strip the score field.
  const rawSources: RawSource[] = [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, OVERALL_CAP)
    .map((s) => {
      // Destructure to drop `score` before returning — keeps the
      // public RawSource shape clean without exposing the ranking
      // signal to downstream consumers.
      const { score: _score, ...rest } = s;
      void _score;
      return rest;
    });

  // Best-effort official website: the first `website`-tagged hit, or the
  // provided inputUrl, whichever exists.
  const officialWebsite =
    inputUrl ??
    rawSources.find((s) => s.sourceType === "website")?.url ??
    null;

  return {
    companyName,
    inputUrl: inputUrl ?? null,
    officialWebsite,
    rawSources,
  };
}

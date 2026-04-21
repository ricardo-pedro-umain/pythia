"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyCandidate } from "@/app/api/disambiguate/route";

/** Best-effort: extract a human-readable company name from a URL.
 *  e.g. "https://www.stripe.com/docs" → "Stripe"
 */
function companyNameFromUrl(raw: string): string {
  try {
    const normalised = raw.startsWith("http") ? raw : `https://${raw}`;
    const url = new URL(normalised);
    const host = url.hostname.replace(/^www\./, "");
    const tld = host.lastIndexOf(".");
    const name = tld > 0 ? host.slice(0, tld) : host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "";
  }
}

/** Normalise a URL-like string so the API receives a proper https:// URL. */
function normaliseUrl(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
}

// User-facing copy for the submit button footer. Hoisted so product can
// tweak the number in one place when real-world timings shift (e.g. after
// the retry loop lands or we upgrade the model).
const ESTIMATED_DURATION_COPY =
  "Typically takes 2–4 minutes depending on data availability";

// ---------------------------------------------------------------------------
// Sub-component: disambiguation picker
// ---------------------------------------------------------------------------

function GlobeSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50">
      <path fillRule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM3.232 5.5a5.5 5.5 0 0 1 2.07-2.344C4.924 4.01 4.55 4.87 4.29 5.5H3.232Zm-1.017 2a5.482 5.482 0 0 1 .19-1H3.5c-.045.324-.07.656-.07 1s.025.676.07 1H2.405a5.482 5.482 0 0 1-.19-1Zm1.017 2H4.29c.26.63.634 1.49 1.012 2.344A5.5 5.5 0 0 1 3.232 9.5Zm2.286 2.856C5.178 11.75 4.77 10.71 4.5 9.5h2a11.31 11.31 0 0 1-.982 2.856ZM4.5 8.5c0-.344.022-.68.065-1h2.935V8.5H4.5Zm0-1.5h2.935V6.5H4.565A9.313 9.313 0 0 0 4.5 7Zm1.018-3.856C5.178 4.25 4.77 5.29 4.5 6.5h2A11.31 11.31 0 0 0 5.518 3.644ZM7.5 2.537V5h.018C7.814 4.158 8.17 3.28 8.482 2.644A5.506 5.506 0 0 0 7.5 2.537Zm1 0v.107A11.31 11.31 0 0 1 9.482 5.5H8.5V2.537ZM9.5 7H8.5v1.5H9.5V7Zm-1-1.5H9.5V7H8.5V5.5Zm1 3H8.5V10h.982C9.478 9.68 9.5 9.344 9.5 9Zm-.982 2.856C8.822 11.75 9.23 10.71 9.5 9.5H7.5a11.31 11.31 0 0 0 .982 2.856 5.506 5.506 0 0 0 .036.007Zm.964.607A5.5 5.5 0 0 0 11.768 11.5h-1.058c-.26.63-.634 1.49-1.012 2.344-.108-.07-.214-.144-.318-.22a5.5 5.5 0 0 0 .104.14Zm.53-1.963H11.5c.045-.324.07-.656.07-1s-.025-.676-.07-1h.012a5.482 5.482 0 0 1 .19 1 5.482 5.482 0 0 1-.19 1Zm-.53-4.5c.378-.854.752-1.49 1.012-2.344a5.5 5.5 0 0 1 .536.288A11.3 11.3 0 0 0 10.482 5.5Zm-1.5-2.856A5.506 5.506 0 0 1 10.5 2.537V5h.018a11.31 11.31 0 0 0-.982-2.856Z" clipRule="evenodd" />
    </svg>
  );
}

interface DisambiguationPickerProps {
  companyName: string;
  candidates: CompanyCandidate[];
  onSelect: (candidate: CompanyCandidate) => void;
  onProceedAnyway: () => void;
  onBack: () => void;
}

function DisambiguationPicker({
  companyName,
  candidates,
  onSelect,
  onProceedAnyway,
  onBack,
}: DisambiguationPickerProps) {
  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Multiple companies match <span className="text-foreground font-medium">&ldquo;{companyName}&rdquo;</span>. Which one?
        </p>
        <button
          onClick={onBack}
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          ← Back
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {candidates.map((c, i) => (
          <button
            key={i}
            onClick={() => onSelect(c)}
            className="flex flex-col gap-1 rounded-lg border border-border/50 bg-card px-4 py-3 text-left hover:border-accent/40 hover:bg-muted/30 transition-colors group"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground group-hover:text-accent transition-colors">
                {c.name}
              </span>
              {c.website && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
                  <GlobeSvg />
                  {c.website.replace(/^https?:\/\/(www\.)?/, "")}
                </span>
              )}
            </div>
            {c.description && (
              <p className="text-xs text-muted-foreground/60 line-clamp-2 leading-relaxed">
                {c.description}
              </p>
            )}
          </button>
        ))}
      </div>

      <button
        onClick={onProceedAnyway}
        className="mt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors text-center"
      >
        None of these — proceed with &ldquo;{companyName}&rdquo; anyway
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Step = "form" | "searching" | "disambiguate" | "starting";

export function CompanyInput() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [candidates, setCandidates] = useState<CompanyCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = companyName.trim() || url.trim();

  // ── Start analysis with a confirmed company/url ──────────────────────────
  async function startAnalysis(resolvedName: string, resolvedUrl?: string) {
    setStep("starting");
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: resolvedName,
          url: resolvedUrl || undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to start analysis");

      const data = await res.json();
      router.push(`/analysis/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("form");
    }
  }

  // ── Form submit → disambiguate or proceed directly ───────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const resolvedName = companyName.trim() || companyNameFromUrl(url.trim());
    const resolvedUrl = normaliseUrl(url.trim());

    if (!resolvedName) {
      setError("Please enter a company name or a valid URL.");
      return;
    }

    // If the user supplied a URL directly, skip disambiguation — they know
    // which company they mean.
    if (url.trim()) {
      await startAnalysis(resolvedName, resolvedUrl);
      return;
    }

    // Search for matching companies
    setStep("searching");
    setError(null);

    try {
      const res = await fetch("/api/disambiguate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: resolvedName }),
      });
      const data = await res.json();
      const found: CompanyCandidate[] = data.candidates ?? [];

      if (found.length <= 1) {
        // Unambiguous — proceed directly
        await startAnalysis(resolvedName, found[0]?.website);
      } else {
        setCandidates(found);
        setStep("disambiguate");
      }
    } catch {
      // Disambiguation failed — fall back to direct analysis
      await startAnalysis(resolvedName);
    }
  }

  // ── User picks a candidate ────────────────────────────────────────────────
  async function handleSelectCandidate(c: CompanyCandidate) {
    await startAnalysis(c.name, c.website);
  }

  // ── User ignores suggestions ──────────────────────────────────────────────
  async function handleProceedAnyway() {
    const resolvedName = companyName.trim() || companyNameFromUrl(url.trim());
    await startAnalysis(resolvedName);
  }

  // ── Disambiguation UI ─────────────────────────────────────────────────────
  if (step === "disambiguate") {
    return (
      <DisambiguationPicker
        companyName={companyName.trim()}
        candidates={candidates}
        onSelect={handleSelectCandidate}
        onBack={() => setStep("form")}
        onProceedAnyway={handleProceedAnyway}
      />
    );
  }

  // ── Form UI ───────────────────────────────────────────────────────────────
  const isLoading = step === "searching" || step === "starting";

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="companyName" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Company Name <span className="opacity-40 normal-case">(or enter a URL below)</span>
        </label>
        <input
          id="companyName"
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g. Stripe, Figma, Anthropic"
          className="rounded-lg border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-colors"
          disabled={isLoading}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="url" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Website URL
        </label>
        <input
          id="url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com  or  www.example.com"
          className="rounded-lg border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-colors"
          disabled={isLoading}
        />
      </div>

      {error && (
        <p className="text-sm text-red-400 animate-fade-in">{error}</p>
      )}

      <button
        type="submit"
        disabled={isLoading || !canSubmit}
        className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 font-medium text-white transition-all hover:bg-accent/90 hover:shadow-[0_0_20px_-4px_rgba(99,102,241,0.4)] disabled:opacity-40 disabled:hover:bg-accent disabled:hover:shadow-none"
      >
        {isLoading && (
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {step === "searching" ? "Finding companies…" : step === "starting" ? "Starting Analysis…" : "Analyze Company"}
      </button>

      <p className="text-center text-xs text-muted-foreground/40">
        {ESTIMATED_DURATION_COPY}
      </p>
    </form>
  );
}

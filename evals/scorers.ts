// Deterministic scorers for eval runs.
//
// Each scorer takes a fully-populated `PythiaAnalysisState` (post-workflow)
// plus the fixture's expectations and returns a normalised score in [0, 1]
// with a short human-readable detail string. Pure functions — no LLM, no
// network — so they can be unit-tested in the regular vitest suite and
// re-run cheaply against saved snapshots.
//
// A `passed` boolean is derived from a scorer-specific threshold. It
// expresses "did this output clear the bar" in a way that's cheap for
// humans to scan. The raw score is what you track over time.

import {
  brandMarketAnalysisSchema,
  companyProfileSchema,
  financialAnalysisSchema,
  qaValidationSchema,
} from "@/mastra/schemas";
import type { CompanyProfile, PythiaAnalysisState } from "@/lib/types";
import type { EvalFixture } from "./fixtures";

export interface ScorerResult {
  name: string;
  score: number; // [0, 1]
  passed: boolean;
  details: string;
}

export type Scorer = (
  state: PythiaAnalysisState,
  fixture: EvalFixture
) => ScorerResult;

// --------------------------------------------------------------------------
// schema validity — the fundamental gate. If the four structured outputs
// don't round-trip through their schemas, nothing else matters.
// --------------------------------------------------------------------------

export const schemaValidScorer: Scorer = (state) => {
  const checks: Array<[string, boolean]> = [
    [
      "companyProfile",
      state.companyProfile !== null &&
        companyProfileSchema.safeParse(state.companyProfile).success,
    ],
    [
      "financialAnalysis",
      state.financialAnalysis !== null &&
        financialAnalysisSchema.safeParse(state.financialAnalysis).success,
    ],
    [
      "brandMarketAnalysis",
      state.brandMarketAnalysis !== null &&
        brandMarketAnalysisSchema.safeParse(state.brandMarketAnalysis).success,
    ],
    [
      "qaValidation",
      state.qaValidation !== null &&
        qaValidationSchema.safeParse(state.qaValidation).success,
    ],
  ];

  const passCount = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);

  return {
    name: "schemaValid",
    score: passCount / checks.length,
    passed: passCount === checks.length,
    details:
      failed.length === 0
        ? `all ${checks.length} structured outputs valid`
        : `failed: ${failed.join(", ")}`,
  };
};

// --------------------------------------------------------------------------
// sources count — raw volume of evidence the data engineer retained. A
// company with ~2 sources is almost certainly a hallucination surface.
// --------------------------------------------------------------------------

export const sourcesCountScorer: Scorer = (state, fixture) => {
  // "Sources used" is reported by the data engineer in its metadata; prefer
  // that over counting rawSources so we score what the agent actually kept.
  const reported = state.companyProfile?.metadata.sourcesUsed ?? 0;
  const ingested = state.ingestion?.rawSources.length ?? 0;

  // Threshold scales with archetype: obscure companies get a lower bar.
  const threshold = fixture.archetype === "obscure" ? 3 : 8;
  const score = Math.min(1, reported / (threshold * 2));

  return {
    name: "sourcesCount",
    score,
    passed: reported >= threshold,
    details: `${reported} reported / ${ingested} ingested (threshold ${threshold})`,
  };
};

// --------------------------------------------------------------------------
// confidence variance — the model should NOT assign the same confidence to
// everything. Uniform values (all 0.5, all 0.8) are a red flag for the
// "I'm just filling the schema" failure mode.
// --------------------------------------------------------------------------

function collectConfidences(profile: CompanyProfile): number[] {
  return [
    profile.founded.confidence,
    profile.headquarters.confidence,
    profile.headcount.confidence,
    profile.funding.totalRaised.confidence,
    profile.revenue.confidence,
    profile.businessModel.confidence,
    ...profile.products.map((p) => p.confidence),
    ...profile.competitors.map((c) => c.confidence),
    ...profile.techStack.map((t) => t.confidence),
  ].filter((v) => typeof v === "number");
}

export const confidenceVarianceScorer: Scorer = (state) => {
  if (!state.companyProfile) {
    return {
      name: "confidenceVariance",
      score: 0,
      passed: false,
      details: "no companyProfile",
    };
  }
  const values = collectConfidences(state.companyProfile);
  if (values.length < 3) {
    return {
      name: "confidenceVariance",
      score: 0,
      passed: false,
      details: `only ${values.length} confidence values — too few to judge`,
    };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  // Healthy variance on [0, 1] confidence values tends to be ~0.10 – 0.25.
  // Map to a [0, 1] score with 0.15 as the sweet spot, capped at 1.
  const score = Math.min(1, stddev / 0.15);

  return {
    name: "confidenceVariance",
    score,
    passed: stddev >= 0.05,
    details: `n=${values.length}, mean=${mean.toFixed(2)}, stddev=${stddev.toFixed(3)}`,
  };
};

// --------------------------------------------------------------------------
// well-known backfill — does the profile mention things a human would
// expect for this specific company? Uses the fixture's `expected` bag.
// --------------------------------------------------------------------------

export const wellKnownBackfillScorer: Scorer = (state, fixture) => {
  const profile = state.companyProfile;
  if (!profile) {
    return {
      name: "wellKnownBackfill",
      score: 0,
      passed: false,
      details: "no companyProfile",
    };
  }

  const exp = fixture.expected;
  const checks: Array<{ label: string; ok: boolean }> = [];

  if (exp.foundedYear != null) {
    const got = profile.founded.value;
    checks.push({
      label: `founded=${exp.foundedYear}`,
      ok: got != null && Math.abs(got - exp.foundedYear) <= 1,
    });
  }

  if (exp.headquartersContains) {
    const got = (profile.headquarters.value ?? "").toLowerCase();
    checks.push({
      label: `hq~"${exp.headquartersContains}"`,
      ok: got.includes(exp.headquartersContains.toLowerCase()),
    });
  }

  if (exp.descriptionContains && exp.descriptionContains.length > 0) {
    const desc = profile.description.toLowerCase();
    const hits = exp.descriptionContains.filter((s) =>
      desc.includes(s.toLowerCase())
    ).length;
    checks.push({
      label: `desc hits ${hits}/${exp.descriptionContains.length}`,
      ok: hits >= 1,
    });
  }

  if (exp.competitorAny && exp.competitorAny.length > 0) {
    const names = profile.competitors.map((c) => c.name.toLowerCase());
    const match = exp.competitorAny.some((c) =>
      names.some((n) => n.includes(c.toLowerCase()))
    );
    checks.push({ label: "competitor match", ok: match });
  }

  if (checks.length === 0) {
    // Nothing to check — neutral, pass by default. Obscure fixtures hit
    // this path deliberately.
    return {
      name: "wellKnownBackfill",
      score: 1,
      passed: true,
      details: "no expectations configured",
    };
  }

  const hits = checks.filter((c) => c.ok).length;
  return {
    name: "wellKnownBackfill",
    score: hits / checks.length,
    passed: hits === checks.length,
    details: checks
      .map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`)
      .join("; "),
  };
};

// --------------------------------------------------------------------------
// graceful degradation — obscure fixtures should produce a low-confidence
// output with honest `gaps` instead of hallucinated certainty.
// --------------------------------------------------------------------------

export const gracefulDegradationScorer: Scorer = (state, fixture) => {
  if (fixture.archetype !== "obscure") {
    return {
      name: "gracefulDegradation",
      score: 1,
      passed: true,
      details: "not applicable (archetype != obscure)",
    };
  }

  const p = state.companyProfile;
  if (!p) {
    return {
      name: "gracefulDegradation",
      score: 0,
      passed: false,
      details: "no companyProfile",
    };
  }

  const confidences = collectConfidences(p);
  const mean =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 1;

  const hasGaps = p.metadata.gaps.length > 0;
  const criticalGaps = p.metadata.gaps.filter(
    (g) => g.severity === "critical"
  ).length;

  // For obscure companies we WANT: mean confidence low-ish AND some gaps
  // reported (ideally critical ones).
  const lowConf = mean <= 0.6 ? 1 : Math.max(0, (0.8 - mean) / 0.2);
  const gapSignal = hasGaps ? (criticalGaps > 0 ? 1 : 0.5) : 0;
  const score = (lowConf + gapSignal) / 2;

  return {
    name: "gracefulDegradation",
    score,
    passed: score >= 0.5,
    details: `mean-conf=${mean.toFixed(2)}, gaps=${p.metadata.gaps.length} (critical ${criticalGaps})`,
  };
};

// --------------------------------------------------------------------------
// qa alignment — the QA validator's own quality score. Re-exposing it as a
// scorer makes it a first-class signal in the run summary.
// --------------------------------------------------------------------------

export const qaAlignmentScorer: Scorer = (state) => {
  const q = state.qaValidation;
  if (!q) {
    return {
      name: "qaAlignment",
      score: 0,
      passed: false,
      details: "no qaValidation",
    };
  }
  return {
    name: "qaAlignment",
    score: Math.max(0, Math.min(1, q.overallQualityScore)),
    passed: q.overallQualityScore >= 0.6,
    details: `qualityLevel=${q.qualityLevel}, overall=${q.overallQualityScore.toFixed(2)}`,
  };
};

// --------------------------------------------------------------------------
// Default pack
// --------------------------------------------------------------------------

export const SCORERS: Scorer[] = [
  schemaValidScorer,
  sourcesCountScorer,
  confidenceVarianceScorer,
  wellKnownBackfillScorer,
  gracefulDegradationScorer,
  qaAlignmentScorer,
];

export function runAllScorers(
  state: PythiaAnalysisState,
  fixture: EvalFixture
): ScorerResult[] {
  return SCORERS.map((s) => s(state, fixture));
}

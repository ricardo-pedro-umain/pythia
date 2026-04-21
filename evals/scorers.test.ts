import { describe, it, expect } from "vitest";
import type { PythiaAnalysisState } from "@/lib/types";
import type { EvalFixture } from "./fixtures";
import {
  confidenceVarianceScorer,
  gracefulDegradationScorer,
  qaAlignmentScorer,
  schemaValidScorer,
  sourcesCountScorer,
  wellKnownBackfillScorer,
} from "./scorers";

// These unit tests pin the scorers' numeric behaviour. They use hand-built
// `PythiaAnalysisState`-shaped fixtures — minimal but valid — so we can
// exercise edge cases (uniform confidences, missing profile, obscure
// archetype) without standing up the real pipeline.

// --------------------------------------------------------------------------
// Helpers — build a minimal state with the pieces each scorer inspects
// --------------------------------------------------------------------------

function baseState(): PythiaAnalysisState {
  return {
    input: { companyName: "Test Co" },
    ingestion: { companyName: "Test Co", inputUrl: null, officialWebsite: null, rawSources: [] },
    companyProfile: null,
    financialAnalysis: null,
    brandMarketAnalysis: null,
    qaValidation: null,
    report: null,
    status: "complete",
    retryCount: 0,
    error: null,
    createdAt: new Date().toISOString(),
    chatMessages: [],
    stepDurations: {},
  };
}

function famousFixture(overrides: Partial<EvalFixture> = {}): EvalFixture {
  return {
    key: "test",
    companyName: "Test Co",
    archetype: "famous",
    expected: {},
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// schemaValidScorer
// --------------------------------------------------------------------------

describe("schemaValidScorer", () => {
  it("fails when structured outputs are missing", () => {
    const r = schemaValidScorer(baseState(), famousFixture());
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
    expect(r.details).toMatch(/companyProfile/);
  });

  it("fails when an output doesn't match its schema", () => {
    const state = baseState();
    // Malformed — wrong shape on purpose
    state.companyProfile = { not: "a profile" } as never;
    const r = schemaValidScorer(state, famousFixture());
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThan(1);
  });
});

// --------------------------------------------------------------------------
// sourcesCountScorer
// --------------------------------------------------------------------------

describe("sourcesCountScorer", () => {
  function stateWithSources(reported: number, ingested: number) {
    const s = baseState();
    s.ingestion!.rawSources = Array.from({ length: ingested }).map((_, i) => ({
      url: `https://example.com/${i}`,
      title: `t${i}`,
      content: "c",
      sourceType: "news" as const,
      dateAccessed: "2024-01-01",
      datePublished: null,
    }));
    s.companyProfile = {
      name: "Test",
      domain: null,
      description: "",
      industry: null,
      founded: { value: null, confidence: 0, sources: [] },
      headquarters: { value: null, confidence: 0, sources: [] },
      headcount: { value: null, confidence: 0, sources: [], range: null },
      funding: {
        totalRaised: { value: null, confidence: 0, sources: [], currency: "USD" },
        lastRound: null,
        fundingHistory: [],
      },
      revenue: { value: null, confidence: 0, sources: [], range: null },
      businessModel: { value: null, confidence: 0, sources: [] },
      products: [],
      competitors: [],
      techStack: [],
      keyPeople: [],
      recentNews: [],
      socialPresence: { linkedin: null, twitter: null, otherProfiles: [] },
      metadata: {
        dataQualityScore: 0,
        sourcesUsed: reported,
        dataFreshness: "recent",
        contradictions: [],
        gaps: [],
      },
    };
    return s;
  }

  it("passes famous archetype when reported >= 8", () => {
    const r = sourcesCountScorer(stateWithSources(10, 20), famousFixture());
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("fails famous archetype when reported < 8", () => {
    const r = sourcesCountScorer(stateWithSources(4, 20), famousFixture());
    expect(r.passed).toBe(false);
  });

  it("obscure archetype uses a lower threshold", () => {
    const r = sourcesCountScorer(
      stateWithSources(3, 5),
      famousFixture({ archetype: "obscure" })
    );
    expect(r.passed).toBe(true);
  });
});

// --------------------------------------------------------------------------
// confidenceVarianceScorer
// --------------------------------------------------------------------------

describe("confidenceVarianceScorer", () => {
  function stateWithConfidences(values: number[]) {
    const s = baseState();
    s.companyProfile = {
      name: "Test",
      domain: null,
      description: "",
      industry: null,
      founded: { value: null, confidence: values[0] ?? 0.5, sources: [] },
      headquarters: { value: null, confidence: values[1] ?? 0.5, sources: [] },
      headcount: {
        value: null,
        confidence: values[2] ?? 0.5,
        sources: [],
        range: null,
      },
      funding: {
        totalRaised: {
          value: null,
          confidence: values[3] ?? 0.5,
          sources: [],
          currency: "USD",
        },
        lastRound: null,
        fundingHistory: [],
      },
      revenue: {
        value: null,
        confidence: values[4] ?? 0.5,
        sources: [],
        range: null,
      },
      businessModel: { value: null, confidence: values[5] ?? 0.5, sources: [] },
      products: (values.slice(6) ?? []).map((v) => ({
        name: "p",
        description: "",
        confidence: v,
      })),
      competitors: [],
      techStack: [],
      keyPeople: [],
      recentNews: [],
      socialPresence: { linkedin: null, twitter: null, otherProfiles: [] },
      metadata: {
        dataQualityScore: 0,
        sourcesUsed: 0,
        dataFreshness: "recent",
        contradictions: [],
        gaps: [],
      },
    };
    return s;
  }

  it("gives a near-zero score for uniform confidences", () => {
    // 6 identical values → stddev = 0
    const r = confidenceVarianceScorer(
      stateWithConfidences([0.7, 0.7, 0.7, 0.7, 0.7, 0.7]),
      famousFixture()
    );
    expect(r.passed).toBe(false);
    // stddev is 0 up to float-rounding; assert a tight upper bound
    expect(r.score).toBeLessThan(1e-6);
  });

  it("gives a high score for healthy spread", () => {
    const r = confidenceVarianceScorer(
      stateWithConfidences([0.95, 0.6, 0.4, 0.85, 0.3, 0.7]),
      famousFixture()
    );
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("fails when there are fewer than 3 values", () => {
    const s = baseState();
    // Everything at the fallback 0.5 — collectConfidences produces >= 6 so
    // we need to actively null out the profile to trigger "too few"
    s.companyProfile = null;
    const r = confidenceVarianceScorer(s, famousFixture());
    expect(r.passed).toBe(false);
  });
});

// --------------------------------------------------------------------------
// wellKnownBackfillScorer
// --------------------------------------------------------------------------

describe("wellKnownBackfillScorer", () => {
  function stateWithProfile(profile: {
    founded?: number | null;
    hq?: string | null;
    description?: string;
    competitors?: string[];
  }) {
    const s = baseState();
    s.companyProfile = {
      name: "Test",
      domain: null,
      description: profile.description ?? "",
      industry: null,
      founded: { value: profile.founded ?? null, confidence: 0.8, sources: [] },
      headquarters: {
        value: profile.hq ?? null,
        confidence: 0.8,
        sources: [],
      },
      headcount: { value: null, confidence: 0, sources: [], range: null },
      funding: {
        totalRaised: {
          value: null,
          confidence: 0,
          sources: [],
          currency: "USD",
        },
        lastRound: null,
        fundingHistory: [],
      },
      revenue: { value: null, confidence: 0, sources: [], range: null },
      businessModel: { value: null, confidence: 0, sources: [] },
      products: [],
      competitors: (profile.competitors ?? []).map((name) => ({
        name,
        overlap: "",
        confidence: 0.7,
        sources: [],
      })),
      techStack: [],
      keyPeople: [],
      recentNews: [],
      socialPresence: { linkedin: null, twitter: null, otherProfiles: [] },
      metadata: {
        dataQualityScore: 0,
        sourcesUsed: 0,
        dataFreshness: "recent",
        contradictions: [],
        gaps: [],
      },
    };
    return s;
  }

  it("scores 1 when all expectations hit", () => {
    const r = wellKnownBackfillScorer(
      stateWithProfile({
        founded: 2010,
        hq: "San Francisco, CA",
        description: "Payment infrastructure for the internet.",
        competitors: ["Adyen", "Checkout.com"],
      }),
      famousFixture({
        expected: {
          foundedYear: 2010,
          headquartersContains: "San Francisco",
          descriptionContains: ["payment"],
          competitorAny: ["Adyen", "Square"],
        },
      })
    );
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });

  it("tolerates a 1-year founded-year drift", () => {
    const r = wellKnownBackfillScorer(
      stateWithProfile({ founded: 2011 }),
      famousFixture({ expected: { foundedYear: 2010 } })
    );
    expect(r.passed).toBe(true);
  });

  it("fails when competitors don't match any expected", () => {
    const r = wellKnownBackfillScorer(
      stateWithProfile({ competitors: ["Totally Unrelated Co"] }),
      famousFixture({ expected: { competitorAny: ["Adyen"] } })
    );
    expect(r.passed).toBe(false);
  });

  it("passes by default when the fixture has no expectations", () => {
    const r = wellKnownBackfillScorer(
      stateWithProfile({}),
      famousFixture({ expected: {} })
    );
    expect(r.passed).toBe(true);
    expect(r.details).toMatch(/no expectations/);
  });
});

// --------------------------------------------------------------------------
// gracefulDegradationScorer
// --------------------------------------------------------------------------

describe("gracefulDegradationScorer", () => {
  it("passes-through for non-obscure archetypes", () => {
    const r = gracefulDegradationScorer(baseState(), famousFixture());
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });

  it("rewards low-confidence + declared gaps on obscure archetype", () => {
    const s = baseState();
    s.companyProfile = {
      name: "Test",
      domain: null,
      description: "",
      industry: null,
      founded: { value: null, confidence: 0.3, sources: [] },
      headquarters: { value: null, confidence: 0.3, sources: [] },
      headcount: { value: null, confidence: 0.3, sources: [], range: null },
      funding: {
        totalRaised: {
          value: null,
          confidence: 0.3,
          sources: [],
          currency: "USD",
        },
        lastRound: null,
        fundingHistory: [],
      },
      revenue: { value: null, confidence: 0.3, sources: [], range: null },
      businessModel: { value: null, confidence: 0.3, sources: [] },
      products: [],
      competitors: [],
      techStack: [],
      keyPeople: [],
      recentNews: [],
      socialPresence: { linkedin: null, twitter: null, otherProfiles: [] },
      metadata: {
        dataQualityScore: 0.3,
        sourcesUsed: 2,
        dataFreshness: "mixed",
        contradictions: [],
        gaps: [
          { field: "revenue.value", severity: "critical" },
          { field: "headcount.value", severity: "critical" },
        ],
      },
    };
    const r = gracefulDegradationScorer(
      s,
      famousFixture({ archetype: "obscure" })
    );
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });

  it("penalises obscure-archetype outputs that hallucinate high confidence with no gaps", () => {
    const s = baseState();
    s.companyProfile = {
      name: "Test",
      domain: null,
      description: "",
      industry: null,
      founded: { value: 2020, confidence: 0.95, sources: [] },
      headquarters: { value: "SF", confidence: 0.95, sources: [] },
      headcount: {
        value: 500,
        confidence: 0.95,
        sources: [],
        range: null,
      },
      funding: {
        totalRaised: {
          value: 100_000_000,
          confidence: 0.95,
          sources: [],
          currency: "USD",
        },
        lastRound: null,
        fundingHistory: [],
      },
      revenue: {
        value: 50_000_000,
        confidence: 0.95,
        sources: [],
        range: null,
      },
      businessModel: { value: "SaaS", confidence: 0.95, sources: [] },
      products: [],
      competitors: [],
      techStack: [],
      keyPeople: [],
      recentNews: [],
      socialPresence: { linkedin: null, twitter: null, otherProfiles: [] },
      metadata: {
        dataQualityScore: 0.95,
        sourcesUsed: 1,
        dataFreshness: "recent",
        contradictions: [],
        gaps: [],
      },
    };
    const r = gracefulDegradationScorer(
      s,
      famousFixture({ archetype: "obscure" })
    );
    expect(r.passed).toBe(false);
  });
});

// --------------------------------------------------------------------------
// qaAlignmentScorer
// --------------------------------------------------------------------------

describe("qaAlignmentScorer", () => {
  it("reflects the QA validator's quality score", () => {
    const s = baseState();
    s.qaValidation = {
      overallQualityScore: 0.82,
      qualityLevel: "high",
      crossValidation: { alignmentScore: 0.9, contradictions: [] },
      confidenceAdjustments: [],
      unsupportedClaims: [],
      criticalGaps: [],
      recommendations: [],
      requiresRerun: false,
      rerunInstructions: null,
    };
    const r = qaAlignmentScorer(s, famousFixture());
    expect(r.passed).toBe(true);
    expect(r.score).toBeCloseTo(0.82, 2);
    expect(r.details).toMatch(/high/);
  });

  it("fails when there is no QA validation", () => {
    const r = qaAlignmentScorer(baseState(), famousFixture());
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
  });
});

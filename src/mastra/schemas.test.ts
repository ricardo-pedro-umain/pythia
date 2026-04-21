import { describe, it, expect } from "vitest";
import type { z } from "zod";
import {
  brandMarketAnalysisSchema,
  companyProfileSchema,
  financialAnalysisSchema,
  qaValidationSchema,
} from "./schemas";

// Type the fixture helpers by `z.infer<…>` rather than letting TypeScript
// infer from the literal payloads — otherwise a `string | null` field whose
// fixture happens to be a string gets inferred as just `string`, and later
// tests that reassign `null` stop compiling.
type CompanyProfile = z.infer<typeof companyProfileSchema>;
type FinancialAnalysis = z.infer<typeof financialAnalysisSchema>;
type BrandMarketAnalysis = z.infer<typeof brandMarketAnalysisSchema>;
type QAValidation = z.infer<typeof qaValidationSchema>;

// These tests anchor the Zod schemas against minimal-but-complete sample
// payloads. Two jobs:
//   1. Prove a well-formed agent response round-trips through `.parse`
//      without loss (and, where the schema declares defaults, that the
//      defaults materialise).
//   2. Catch common malformed shapes — missing required keys, wrong enum
//      values, stray types — so a refactor of the schemas themselves shows
//      up as a test failure rather than a silent pipeline regression.
//
// Every fixture lives inline so the file is the single source of truth.

// --------------------------------------------------------------------------
// CompanyProfile
// --------------------------------------------------------------------------

function validCompanyProfile(): CompanyProfile {
  return {
    name: "Stripe",
    domain: "stripe.com",
    description: "Financial infrastructure for the internet.",
    industry: "Fintech",
    founded: { value: 2010, confidence: 0.9, sources: ["stripe.com"] },
    headquarters: {
      value: "San Francisco, CA",
      confidence: 0.8,
      sources: ["wikipedia.org"],
    },
    headcount: {
      value: 7000,
      confidence: 0.7,
      sources: ["linkedin.com"],
      range: "5000-10000",
    },
    funding: {
      totalRaised: {
        value: 2_200_000_000,
        confidence: 0.85,
        sources: ["crunchbase.com"],
        currency: "USD",
      },
      lastRound: {
        type: "Series I",
        amount: 600_000_000,
        date: "2023-03-15",
        investors: ["Thrive Capital"],
        confidence: 0.9,
        sources: ["techcrunch.com"],
      },
      fundingHistory: [],
    },
    revenue: {
      value: null,
      confidence: 0.4,
      sources: [],
      range: "$1B+",
    },
    businessModel: {
      value: "Transaction fees on payment processing",
      confidence: 0.95,
      sources: ["stripe.com"],
    },
    products: [
      { name: "Payments", description: "Online payment processing", confidence: 0.95 },
    ],
    competitors: [
      {
        name: "Adyen",
        overlap: "Payment processing",
        confidence: 0.9,
        sources: ["forbes.com"],
      },
    ],
    techStack: [
      { technology: "Ruby", confidence: 0.6, source: "engineering blog" },
    ],
    keyPeople: [
      { name: "Patrick Collison", role: "CEO", confidence: 0.99, source: "stripe.com" },
    ],
    recentNews: [
      {
        title: "Stripe launches X",
        summary: "Summary here",
        date: "2024-06-01",
        url: "https://stripe.com/blog/x",
        sentiment: "positive" as const,
      },
    ],
    socialPresence: {
      linkedin: "https://linkedin.com/company/stripe",
      twitter: "https://twitter.com/stripe",
      otherProfiles: [],
    },
    metadata: {
      dataQualityScore: 0.8,
      sourcesUsed: 12,
      dataFreshness: "recent" as const,
      contradictions: [],
      gaps: [{ field: "revenue.value", severity: "minor" as const }],
    },
  };
}

describe("companyProfileSchema", () => {
  it("accepts a well-formed profile", () => {
    const parsed = companyProfileSchema.parse(validCompanyProfile());
    expect(parsed.name).toBe("Stripe");
    expect(parsed.funding.lastRound?.investors).toEqual(["Thrive Capital"]);
  });

  it("applies the default empty-array for fundingRound.investors when omitted", () => {
    const payload = validCompanyProfile();
    // Simulate an agent that forgot the investors key on lastRound.
    const lastRound = { ...payload.funding.lastRound! } as Record<string, unknown>;
    delete lastRound.investors;
    payload.funding.lastRound = lastRound as typeof payload.funding.lastRound;

    const parsed = companyProfileSchema.parse(payload);
    expect(parsed.funding.lastRound?.investors).toEqual([]);
  });

  it("rejects an unknown sentiment enum value on recentNews", () => {
    const bad = validCompanyProfile();
    bad.recentNews[0].sentiment = "mixed" as never; // not in the enum
    const res = companyProfileSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it("rejects missing top-level keys", () => {
    const bad = validCompanyProfile() as Record<string, unknown>;
    delete bad.metadata;
    const res = companyProfileSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it("rejects wrong types on confidence scalars", () => {
    const bad = validCompanyProfile();
    // confidence must be a number
    (bad.founded as unknown as { confidence: unknown }).confidence = "high";
    const res = companyProfileSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it("accepts nulls on the nullable leaves (value, range, domain, lastRound)", () => {
    const payload = validCompanyProfile();
    payload.domain = null;
    payload.revenue.value = null;
    payload.revenue.range = null;
    payload.funding.lastRound = null;
    payload.headcount.value = null;
    payload.headcount.range = null;

    const res = companyProfileSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });
});

// --------------------------------------------------------------------------
// FinancialAnalysis
// --------------------------------------------------------------------------

function validFinancialAnalysis(): FinancialAnalysis {
  return {
    fundingAssessment: {
      summary: "Well-funded with strong investor syndicate.",
      score: "strong" as const,
      details: "Raised $2.2B across multiple rounds.",
    },
    revenueAnalysis: {
      estimatedARR: { low: 12_000_000_000, high: 15_000_000_000 },
      growthTrajectory: "High double-digit YoY",
      confidence: 0.7,
    },
    marketSize: {
      tam: "$1T",
      sam: "$200B",
      som: "$20B",
      confidence: 0.6,
    },
    unitEconomics: {
      summary: "Healthy take rate, scaling infra costs.",
      signals: ["~2.9% + 30c per transaction"],
      confidence: 0.65,
    },
    financialRisks: [
      {
        risk: "Interchange pressure",
        severity: "medium" as const,
        explanation: "Regulatory caps in EU could compress margins.",
      },
    ],
    comparables: [
      { company: "Adyen", relevance: "Direct competitor", valuation: "€40B" },
    ],
    overallFinancialHealth: {
      score: "strong" as const,
      summary: "Financially robust; private with no near-term liquidity needs.",
    },
    confidence: 0.75,
    evidenceSources: ["techcrunch.com", "crunchbase.com"],
  };
}

describe("financialAnalysisSchema", () => {
  it("accepts a well-formed analysis", () => {
    const parsed = financialAnalysisSchema.parse(validFinancialAnalysis());
    expect(parsed.overallFinancialHealth.score).toBe("strong");
  });

  it("accepts null low/high on estimatedARR", () => {
    const p = validFinancialAnalysis();
    p.revenueAnalysis.estimatedARR = { low: null, high: null };
    expect(financialAnalysisSchema.safeParse(p).success).toBe(true);
  });

  it("rejects fundingAssessment.score outside its enum", () => {
    const bad = validFinancialAnalysis();
    (bad.fundingAssessment as unknown as { score: string }).score = "excellent";
    expect(financialAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects overallFinancialHealth.score outside its enum", () => {
    const bad = validFinancialAnalysis();
    (bad.overallFinancialHealth as unknown as { score: string }).score = "great";
    expect(financialAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});

// --------------------------------------------------------------------------
// BrandMarketAnalysis
// --------------------------------------------------------------------------

function validBrandMarketAnalysis(): BrandMarketAnalysis {
  return {
    brandPositioning: {
      valueProposition: "Developer-first payment infra.",
      targetAudience: "Engineering-led companies",
      toneAndPersonality: "Precise, technical, polished",
      confidence: 0.8,
    },
    marketPositioning: {
      category: "Payment processing",
      position: "leader" as const,
      marketShare: "~20% of developer-led fintech",
      confidence: 0.7,
    },
    competitiveAnalysis: {
      summary: "Leads in developer experience; Adyen leads in enterprise.",
      competitors: [
        {
          name: "Adyen",
          strengths: ["Enterprise integrations"],
          weaknesses: ["Slower SMB onboarding"],
          differentiator: "Single global platform",
        },
      ],
    },
    sentiment: {
      overall: "positive" as const,
      signals: [
        {
          text: "Stripe's docs are the gold standard.",
          source: "hacker news",
          sentiment: "positive" as const,
        },
      ],
      confidence: 0.75,
    },
    brandRisks: [
      {
        risk: "Downtime perception",
        severity: "low" as const,
        explanation: "Recent outages got coverage but no sustained impact.",
      },
    ],
    growthSignals: [
      { signal: "Hiring 200 engineers in Dublin", type: "hiring" as const, source: "linkedin.com" },
      { signal: "Launched new Radar product", type: "product" as const, source: "stripe.com" },
    ],
    overallBrandHealth: {
      score: "strong" as const,
      summary: "Strong mindshare among developers.",
    },
    confidence: 0.78,
    evidenceSources: ["stripe.com", "news.ycombinator.com"],
  };
}

describe("brandMarketAnalysisSchema", () => {
  it("accepts a well-formed payload", () => {
    expect(brandMarketAnalysisSchema.parse(validBrandMarketAnalysis()).overallBrandHealth.score).toBe(
      "strong"
    );
  });

  it("rejects an unknown marketPositioning.position", () => {
    const bad = validBrandMarketAnalysis();
    (bad.marketPositioning as unknown as { position: string }).position = "dominant";
    expect(brandMarketAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown growthSignals.type", () => {
    const bad = validBrandMarketAnalysis();
    (bad.growthSignals[0] as unknown as { type: string }).type = "fundraising";
    expect(brandMarketAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts null marketShare", () => {
    const p = validBrandMarketAnalysis();
    p.marketPositioning.marketShare = null;
    expect(brandMarketAnalysisSchema.safeParse(p).success).toBe(true);
  });
});

// --------------------------------------------------------------------------
// QAValidation
// --------------------------------------------------------------------------

function validQAValidation(): QAValidation {
  return {
    overallQualityScore: 0.82,
    qualityLevel: "high" as const,
    crossValidation: {
      alignmentScore: 0.9,
      contradictions: [
        {
          between: "headcount vs jobs posted",
          description: "Headcount says 7000, 400 open roles implies faster growth.",
          severity: "low" as const,
        },
      ],
    },
    confidenceAdjustments: [
      {
        section: "revenueAnalysis",
        originalConfidence: 0.7,
        adjustedConfidence: 0.5,
        reason: "Figures not verifiable from primary sources.",
      },
    ],
    unsupportedClaims: [
      {
        claim: "Market leader in APAC",
        section: "marketPositioning",
        recommendation: "Source regional share data.",
      },
    ],
    criticalGaps: [
      {
        field: "revenue.value",
        importance: "important" as const,
        searchSuggestion: "Stripe revenue 2024 filings",
      },
    ],
    recommendations: [
      { action: "Re-run with revenue-focused queries", priority: "high" as const },
    ],
    requiresRerun: false,
    rerunInstructions: null,
  };
}

describe("qaValidationSchema", () => {
  it("accepts a well-formed payload", () => {
    const parsed = qaValidationSchema.parse(validQAValidation());
    expect(parsed.requiresRerun).toBe(false);
    expect(parsed.rerunInstructions).toBeNull();
  });

  it("accepts a rerun-requested shape with instructions", () => {
    const p = validQAValidation();
    p.requiresRerun = true;
    p.rerunInstructions = "Search for annual revenue. Look for ARR disclosures.";
    expect(qaValidationSchema.safeParse(p).success).toBe(true);
  });

  it("rejects qualityLevel outside enum", () => {
    const bad = validQAValidation();
    (bad as unknown as { qualityLevel: string }).qualityLevel = "excellent";
    expect(qaValidationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects criticalGaps.importance outside enum", () => {
    const bad = validQAValidation();
    (bad.criticalGaps[0] as unknown as { importance: string }).importance = "blocker";
    expect(qaValidationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects non-boolean requiresRerun", () => {
    const bad = validQAValidation();
    (bad as unknown as { requiresRerun: unknown }).requiresRerun = "yes";
    expect(qaValidationSchema.safeParse(bad).success).toBe(false);
  });
});

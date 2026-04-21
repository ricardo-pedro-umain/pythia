// Zod schemas for each agent's structured JSON output.
//
// These drive two things:
//   1. `agent.generate(prompt, { structuredOutput: { schema } })` — Mastra
//      feeds the schema to the model so the raw output is already shaped
//      correctly, with fewer "model emitted a stray ```json fence" failures.
//   2. A defensive `safeParse` fallback for legacy `agent.generate()` calls
//      that still return a raw `text` string — see `parse-agent-output.ts`.
//
// The shapes mirror the TS interfaces in `src/lib/types.ts`. Keeping them in
// lock-step is a manual chore; when you change one, change the other. A
// future refactor could derive the TS types from these schemas via
// `z.infer`, but the types came first here so we preserve them.

import { z } from "zod";

// ---------- shared fragments ----------

const confidenceValue = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value,
    confidence: z.number(),
    sources: z.array(z.string()),
  });

const fundingRound = z.object({
  type: z.string(),
  amount: z.number().nullable(),
  date: z.string().nullable(),
  investors: z.array(z.string()).default([]),
  confidence: z.number(),
  sources: z.array(z.string()),
});

// ---------- data-engineer: CompanyProfile ----------

export const companyProfileSchema = z.object({
  name: z.string(),
  domain: z.string().nullable(),
  description: z.string(),
  industry: z.string().nullable(),
  founded: confidenceValue(z.number().nullable()),
  headquarters: confidenceValue(z.string().nullable()),
  headcount: confidenceValue(z.number().nullable()).extend({
    range: z.string().nullable(),
  }),
  funding: z.object({
    totalRaised: confidenceValue(z.number().nullable()).extend({
      currency: z.string(),
    }),
    lastRound: fundingRound.nullable(),
    fundingHistory: z.array(fundingRound),
  }),
  revenue: confidenceValue(z.number().nullable()).extend({
    range: z.string().nullable(),
  }),
  businessModel: confidenceValue(z.string().nullable()),
  products: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      confidence: z.number(),
    })
  ),
  competitors: z.array(
    z.object({
      name: z.string(),
      overlap: z.string(),
      confidence: z.number(),
      sources: z.array(z.string()),
    })
  ),
  techStack: z.array(
    z.object({
      technology: z.string(),
      confidence: z.number(),
      source: z.string(),
    })
  ),
  keyPeople: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      confidence: z.number(),
      source: z.string(),
    })
  ),
  recentNews: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      date: z.string(),
      url: z.string(),
      sentiment: z.enum(["positive", "neutral", "negative"]),
    })
  ),
  socialPresence: z.object({
    linkedin: z.string().nullable(),
    twitter: z.string().nullable(),
    otherProfiles: z.array(
      z.object({ platform: z.string(), url: z.string() })
    ),
  }),
  metadata: z.object({
    dataQualityScore: z.number(),
    sourcesUsed: z.number(),
    dataFreshness: z.enum(["recent", "mixed", "stale"]),
    contradictions: z.array(
      z.object({ field: z.string(), description: z.string() })
    ),
    gaps: z.array(
      z.object({
        field: z.string(),
        severity: z.enum(["critical", "minor"]),
      })
    ),
  }),
});

// ---------- financial-analyst: FinancialAnalysis ----------

export const financialAnalysisSchema = z.object({
  fundingAssessment: z.object({
    summary: z.string(),
    score: z.enum(["strong", "adequate", "concerning", "unknown"]),
    details: z.string(),
  }),
  revenueAnalysis: z.object({
    estimatedARR: z.object({
      low: z.number().nullable(),
      high: z.number().nullable(),
    }),
    growthTrajectory: z.string(),
    confidence: z.number(),
  }),
  marketSize: z.object({
    tam: z.string().nullable(),
    sam: z.string().nullable(),
    som: z.string().nullable(),
    confidence: z.number(),
  }),
  unitEconomics: z.object({
    summary: z.string(),
    signals: z.array(z.string()),
    confidence: z.number(),
  }),
  financialRisks: z.array(
    z.object({
      risk: z.string(),
      severity: z.enum(["high", "medium", "low"]),
      explanation: z.string(),
    })
  ),
  comparables: z.array(
    z.object({
      company: z.string(),
      relevance: z.string(),
      valuation: z.string().nullable(),
    })
  ),
  overallFinancialHealth: z.object({
    score: z.enum(["strong", "moderate", "weak", "insufficient_data"]),
    summary: z.string(),
  }),
  confidence: z.number(),
  evidenceSources: z.array(z.string()),
});

// ---------- brand-market: BrandMarketAnalysis ----------

export const brandMarketAnalysisSchema = z.object({
  brandPositioning: z.object({
    valueProposition: z.string(),
    targetAudience: z.string(),
    toneAndPersonality: z.string(),
    confidence: z.number(),
  }),
  marketPositioning: z.object({
    category: z.string(),
    position: z.enum(["leader", "challenger", "niche", "emerging"]),
    marketShare: z.string().nullable(),
    confidence: z.number(),
  }),
  competitiveAnalysis: z.object({
    summary: z.string(),
    competitors: z.array(
      z.object({
        name: z.string(),
        strengths: z.array(z.string()),
        weaknesses: z.array(z.string()),
        differentiator: z.string(),
      })
    ),
  }),
  sentiment: z.object({
    overall: z.enum(["positive", "neutral", "negative", "mixed"]),
    signals: z.array(
      z.object({
        text: z.string(),
        source: z.string(),
        sentiment: z.enum(["positive", "neutral", "negative"]),
      })
    ),
    confidence: z.number(),
  }),
  brandRisks: z.array(
    z.object({
      risk: z.string(),
      severity: z.enum(["high", "medium", "low"]),
      explanation: z.string(),
    })
  ),
  growthSignals: z.array(
    z.object({
      signal: z.string(),
      type: z.enum(["hiring", "product", "expansion", "partnership", "other"]),
      source: z.string(),
    })
  ),
  overallBrandHealth: z.object({
    score: z.enum(["strong", "moderate", "weak", "insufficient_data"]),
    summary: z.string(),
  }),
  confidence: z.number(),
  evidenceSources: z.array(z.string()),
});

// ---------- qa-validator: QAValidation ----------

export const qaValidationSchema = z.object({
  overallQualityScore: z.number(),
  qualityLevel: z.enum(["high", "medium", "low"]),
  crossValidation: z.object({
    alignmentScore: z.number(),
    contradictions: z.array(
      z.object({
        between: z.string(),
        description: z.string(),
        severity: z.enum(["high", "medium", "low"]),
      })
    ),
  }),
  confidenceAdjustments: z.array(
    z.object({
      section: z.string(),
      originalConfidence: z.number(),
      adjustedConfidence: z.number(),
      reason: z.string(),
    })
  ),
  unsupportedClaims: z.array(
    z.object({
      claim: z.string(),
      section: z.string(),
      recommendation: z.string(),
    })
  ),
  criticalGaps: z.array(
    z.object({
      field: z.string(),
      importance: z.enum(["critical", "important", "nice_to_have"]),
      searchSuggestion: z.string(),
    })
  ),
  recommendations: z.array(
    z.object({
      action: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    })
  ),
  requiresRerun: z.boolean(),
  rerunInstructions: z.string().nullable(),
});

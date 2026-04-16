// === Ingestion Agent Output ===

export interface RawSource {
  url: string;
  title: string;
  content: string;
  sourceType: "website" | "news" | "social" | "financial" | "review";
  dateAccessed: string;
  datePublished: string | null;
}

export interface RawIngestionResult {
  companyName: string;
  inputUrl: string | null;
  officialWebsite: string | null;
  rawSources: RawSource[];
}

// === Data Engineer Agent Output ===

export interface ConfidenceValue<T> {
  value: T;
  confidence: number;
  sources: string[];
}

export interface FundingRound {
  type: string;
  amount: number | null;
  date: string | null;
  investors: string[];
  confidence: number;
  sources: string[];
}

export interface CompanyProfile {
  name: string;
  domain: string | null;
  description: string;
  industry: string | null;
  founded: ConfidenceValue<number | null>;
  headquarters: ConfidenceValue<string | null>;
  headcount: ConfidenceValue<number | null> & { range: string | null };
  funding: {
    totalRaised: ConfidenceValue<number | null> & { currency: string };
    lastRound: FundingRound | null;
    fundingHistory: FundingRound[];
  };
  revenue: ConfidenceValue<number | null> & { range: string | null };
  businessModel: ConfidenceValue<string | null>;
  products: Array<{ name: string; description: string; confidence: number }>;
  competitors: Array<{
    name: string;
    overlap: string;
    confidence: number;
    sources: string[];
  }>;
  techStack: Array<{
    technology: string;
    confidence: number;
    source: string;
  }>;
  keyPeople: Array<{
    name: string;
    role: string;
    confidence: number;
    source: string;
  }>;
  recentNews: Array<{
    title: string;
    summary: string;
    date: string;
    url: string;
    sentiment: "positive" | "neutral" | "negative";
  }>;
  socialPresence: {
    linkedin: string | null;
    twitter: string | null;
    otherProfiles: Array<{ platform: string; url: string }>;
  };
  metadata: {
    dataQualityScore: number;
    sourcesUsed: number;
    dataFreshness: "recent" | "mixed" | "stale";
    contradictions: Array<{ field: string; description: string }>;
    gaps: Array<{ field: string; severity: "critical" | "minor" }>;
  };
}

// === Financial Analyst Agent Output ===

export interface FinancialAnalysis {
  fundingAssessment: {
    summary: string;
    score: "strong" | "adequate" | "concerning" | "unknown";
    details: string;
  };
  revenueAnalysis: {
    estimatedARR: { low: number | null; high: number | null };
    growthTrajectory: string;
    confidence: number;
  };
  marketSize: {
    tam: string | null;
    sam: string | null;
    som: string | null;
    confidence: number;
  };
  unitEconomics: {
    summary: string;
    signals: string[];
    confidence: number;
  };
  financialRisks: Array<{
    risk: string;
    severity: "high" | "medium" | "low";
    explanation: string;
  }>;
  comparables: Array<{
    company: string;
    relevance: string;
    valuation: string | null;
  }>;
  overallFinancialHealth: {
    score: "strong" | "moderate" | "weak" | "insufficient_data";
    summary: string;
  };
  confidence: number;
  evidenceSources: string[];
}

// === Brand & Market Agent Output ===

export interface BrandMarketAnalysis {
  brandPositioning: {
    valueProposition: string;
    targetAudience: string;
    toneAndPersonality: string;
    confidence: number;
  };
  marketPositioning: {
    category: string;
    position: "leader" | "challenger" | "niche" | "emerging";
    marketShare: string | null;
    confidence: number;
  };
  competitiveAnalysis: {
    summary: string;
    competitors: Array<{
      name: string;
      strengths: string[];
      weaknesses: string[];
      differentiator: string;
    }>;
  };
  sentiment: {
    overall: "positive" | "neutral" | "negative" | "mixed";
    signals: Array<{
      text: string;
      source: string;
      sentiment: "positive" | "neutral" | "negative";
    }>;
    confidence: number;
  };
  brandRisks: Array<{
    risk: string;
    severity: "high" | "medium" | "low";
    explanation: string;
  }>;
  growthSignals: Array<{
    signal: string;
    type: "hiring" | "product" | "expansion" | "partnership" | "other";
    source: string;
  }>;
  overallBrandHealth: {
    score: "strong" | "moderate" | "weak" | "insufficient_data";
    summary: string;
  };
  confidence: number;
  evidenceSources: string[];
}

// === QA Agent Output ===

export interface QAValidation {
  overallQualityScore: number;
  qualityLevel: "high" | "medium" | "low";
  crossValidation: {
    alignmentScore: number;
    contradictions: Array<{
      between: string;
      description: string;
      severity: "high" | "medium" | "low";
    }>;
  };
  confidenceAdjustments: Array<{
    section: string;
    originalConfidence: number;
    adjustedConfidence: number;
    reason: string;
  }>;
  unsupportedClaims: Array<{
    claim: string;
    section: string;
    recommendation: string;
  }>;
  criticalGaps: Array<{
    field: string;
    importance: "critical" | "important" | "nice_to_have";
    searchSuggestion: string;
  }>;
  recommendations: Array<{
    action: string;
    priority: "high" | "medium" | "low";
  }>;
  requiresRerun: boolean;
  rerunInstructions: string | null;
}

// === Full Analysis State ===

export interface PythiaAnalysisState {
  input: { companyName: string; url?: string };
  ingestion: RawIngestionResult | null;
  companyProfile: CompanyProfile | null;
  financialAnalysis: FinancialAnalysis | null;
  brandMarketAnalysis: BrandMarketAnalysis | null;
  qaValidation: QAValidation | null;
  report: string | null;
  status:
    | "idle"
    | "ingesting"
    | "cleaning"
    | "analyzing"
    | "validating"
    | "generating_report"
    | "complete"
    | "error";
  retryCount: number;
  error: string | null;
  createdAt: string;
}

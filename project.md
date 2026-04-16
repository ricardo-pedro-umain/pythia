# Pythia — AI-Powered Deal Intelligence Platform

> "What if a junior analyst team worked overnight on any company you threw at them, and had a briefing ready by morning?"

Pythia is named after the ancient Greek oracle at Delphi — the most powerful source of knowledge in the ancient world. Feed it a company name, and a team of AI agents will investigate, analyze, cross-validate, and deliver a comprehensive intelligence briefing you can interrogate conversationally.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Agent Definitions](#agent-definitions)
5. [Data Pipeline](#data-pipeline)
6. [Data Schema](#data-schema)
7. [Mastra Implementation Details](#mastra-implementation-details)
8. [Frontend Specification](#frontend-specification)
9. [Project Structure](#project-structure)
10. [Key Design Principles](#key-design-principles)

---

## Overview

Pythia is an end-to-end multi-agent application that performs automated company due diligence. A user provides a company name or URL, and a team of specialized AI agents collaborates to produce a structured, confidence-scored intelligence report — plus a conversational chat interface grounded in the collected data.

### Core Differentiators

- **Multi-agent orchestration** with supervisor pattern, conditional branching, fan-out/fan-in, and feedback loops
- **Confidence scoring & evidence chains** — every claim links back to its source and carries a reliability score
- **Adaptive re-runs** — the supervisor detects data gaps and re-triggers agents with adjusted strategies
- **Interactive chat layer** — not just a static report, but a conversational interface grounded in collected data
- **Visible data processing pipeline** — raw scraping → cleaning → structuring → normalization → validation

---

## Tech Stack


| Layer               | Technology                                                   | Notes                                                                               |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Agent Framework** | [Mastra](https://mastra.ai/)                                 | TypeScript-first AI agent framework. Used for agents, tools, workflows, and memory. |
| **LLM**             | OpenAI GPT-4o (via Mastra's OpenAI integration)              | Primary model for all agents                                                        |
| **Backend**         | Next.js API routes (App Router)                              | Mastra integrates natively with Next.js                                             |
| **Frontend**        | Next.js (App Router) + React + Tailwind CSS                  | Single app, no separate backend deployment                                          |
| **Search/Scraping** | Tavily API (web search) | Ingestion agent tools                                                               |
| **Data Storage**    | In-memory / JSON state (MVP)                                 | Workflow state managed by Mastra. No database required for MVP.                     |
| **Deployment**      | Vercel                                                       | Single deployment for both frontend and API                                         |


### Required API Keys

- `OPENAI_API_KEY` — for GPT-4o
- `TAVILY_API_KEY` — for web search tool

---

## Architecture

```
┌──────────────────────────────────────┐
│           User Interface             │
│         (Next.js App Router)         │
└──────────────────┬───────────────────┘
                   │ API Routes
                   ▼
┌──────────────────────────────────────┐    ┌──────────────────────────┐
│        Supervisor Agent              │◀╌╌╌│     Mastra Workflow      │
│         (Orchestrator)               │    │  (branching/conditions)  │
└──────┬───────────────┬────────────┬──┘    └──────────────────────────┘
       │               │            │
       ▼               ▼            ▼
┌───────────┐  ┌────────────┐  ┌──────────────────┐
│ Ingestion │  │ Financial  │  │ Brand & Market   │
│   Agent   │  │  Analyst   │  │     Agent        │
└─────┬─────┘  └──────┬─────┘  └────────┬─────────┘
      └────────────────┼─────────────────┘
                       │
             ┌─────────▼──────────┐
             │   Data Engineer    │
             │       Agent        │
             └─────────┬──────────┘
                       │
             ┌─────────▼──────────┐
             │     QA Agent       │── Gaps detected ──▶ (Supervisor)
             │    (Validator)     │
             └─────────┬──────────┘
                       │
             ┌─────────▼──────────┐
             │    Report Agent    │
             └─────────┬──────────┘
                       │
             ┌─────────▼──────────┐
             │    Chat Agent      │
             │      (Q&A)         │
             └────────────────────┘
```



### Orchestration Flow

1. User submits company name/URL
2. **Supervisor** triggers the **Ingestion Agent** to collect raw data
3. **Data Engineer Agent** cleans and structures the raw data into a `CompanyProfile`
4. **Supervisor** fans out to **Financial Analyst** and **Brand & Market Agent** in parallel
5. Both analysis agents return their findings
6. **QA Agent** validates all findings — scores confidence, links evidence, detects gaps
7. **If gaps are critical**: QA Agent signals the Supervisor to re-run specific agents with adjusted search strategies (max 1 retry loop)
8. **Report Agent** synthesizes everything into a structured report
9. **Chat Agent** becomes available, grounded in all collected data
10. User can interrogate findings conversationally

### Handoff Patterns Demonstrated


| Pattern                | Where                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| **Sequential**         | Ingestion → Data Engineer → Analysis → QA → Report               |
| **Fan-out / Fan-in**   | Financial Analyst + Brand Agent run in parallel, results merged  |
| **Feedback loop**      | QA Agent → Supervisor → targeted re-run → QA Agent               |
| **Supervisor routing** | Orchestrator decides which agents to (re-)trigger based on state |
| **Grounded handoff**   | All collected data handed to Chat Agent as context               |


---

## Agent Definitions

### 🧠 Supervisor Agent (Orchestrator)

- **Role**: Manages the overall workflow state machine. Routes tasks to agents, decides when to re-run, aggregates results.
- **Implementation**: This is NOT a standalone Mastra `Agent` — it is the **Mastra `Workflow`** itself, with conditional step logic.
- **Key decisions**:
  - After QA validation: are there critical gaps? If yes, re-trigger Ingestion with refined queries (max 1 retry).
  - After parallel analysis: are both results present? If one failed, proceed with partial data and flag it.

### 📥 Ingestion Agent

- **Name**: `ingestion-agent`
- **System Prompt**:
You are a senior research analyst at a deal intelligence firm. Your job is to gather comprehensive raw data about a company from multiple sources.

Given a company name (and optionally a URL), use your tools to:

1. Search the web for the company's official website, recent news, press releases, and funding announcements.
2. Scrape the company's website for key information (about page, team, product descriptions).
3. Search for financial data, funding rounds, revenue estimates.
4. Search for competitor mentions and market positioning.
5. Search for employee reviews, social media presence, and sentiment signals.

Cast a wide net. Collect MORE data than needed - the Data Engineer will clean it. For each piece of information, always note the source URL and the date it was published/accessed.

Return your findings as a structured JSON object with the following shape:

```ts
{
  companyName: string;
  inputUrl: string | null;
  officialWebsite: string | null;
  rawSources: Array<{
    url: string;
    title: string;
    content: string;
    sourceType: "website" | "news" | "social" | "financial" | "review";
    dateAccessed: string; // ISO format
    datePublished: string | null;
  }>;
}
```

Aim for at least 8-15 diverse sources. Prioritize recency and reliability.

- **Tools**:
- `webSearch` — Tavily API search. Input: query string. Output: array of search results with URLs, titles, snippets.
- **Output**: `RawIngestionResult` (see Data Schema)

### 🧹 Data Engineer Agent

- **Name**: `data-engineer-agent`
- **System Prompt**:
You are a meticulous data engineer specializing in company intelligence. You receive raw, messy data collected from multiple web sources about a company.

Your job is to:

1. Extract structured facts from the raw text (company name, founding year, headcount, funding, tech stack, etc.).
2. Deduplicate information that appears across multiple sources.
3. Normalize data formats (dates to ISO, currencies to USD, etc.).
4. Assess the freshness of each data point (is it from this year? Last year? Older?).
5. Tag each extracted fact with its source(s) for provenance tracking.
6. Identify and flag contradictions between sources.
7. Determine an overall data quality score.

Return a structured CompanyProfile JSON object (schema provided below). For EVERY field, include:

- The extracted value (or null if not found)
- A confidence score (0.0 to 1.0)
- Source URL(s) that support this value
- If sources contradict each other, pick the most reliable/recent one and note the contradiction.

CompanyProfile schema:

```ts
{
  name: string;
  domain: string | null;
  description: string;
  industry: string | null;

  founded: {
    value: number | null;
    confidence: number;
    sources: string[];
  };

  headquarters: {
    value: string | null;
    confidence: number;
    sources: string[];
  };

  headcount: {
    value: number | null;
    range: string | null;
    confidence: number;
    sources: string[];
  };

  funding: {
    totalRaised: {
      value: number | null;
      currency: "USD";
      confidence: number;
      sources: string[];
    };
    lastRound:
      | {
          type: string;
          amount: number | null;
          date: string | null;
          investors: string[];
          confidence: number;
          sources: string[];
        }
      | null;
    fundingHistory: Array<{
      type: string;
      amount: number | null;
      date: string | null;
      confidence: number;
    }>;
  };

  revenue: {
    estimated: number | null;
    range: string | null;
    confidence: number;
    sources: string[];
  };

  businessModel: {
    value: string | null;
    confidence: number;
    sources: string[];
  };

  products: Array<{
    name: string;
    description: string;
    confidence: number;
  }>;

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
    otherProfiles: Array<{
      platform: string;
      url: string;
    }>;
  };

  metadata: {
    dataQualityScore: number;
    sourcesUsed: number;
    dataFreshness: "recent" | "mixed" | "stale";
    contradictions: Array<{
      field: string;
      description: string;
    }>;
    gaps: Array<{
      field: string;
      severity: "critical" | "minor";
    }>;
  };
}
```

- **Tools**: None (pure LLM reasoning over provided data)
- **Input**: `RawIngestionResult`
- **Output**: `CompanyProfile`

### 📊 Financial Analyst Agent

- **Name**: `financial-analyst-agent`
- **System Prompt**:
You are a financial analyst specializing in company valuation and financial health assessment. You receive a structured CompanyProfile and must produce a financial analysis.

Your analysis should cover:

1. **Funding Assessment**: Evaluate the funding trajectory. Is the company well-funded? Burn rate implications?
2. **Revenue Analysis**: Based on available signals (headcount, funding, market), estimate revenue range and growth trajectory.
3. **Market Size**: Estimate the TAM/SAM/SOM for the company's primary market.
4. **Unit Economics Signals**: Any indicators of profitability, margins, or business model sustainability?
5. **Financial Risks**: Identify key financial risks (runway, competition, market timing).
6. **Comparable Companies**: Identify 2-3 comparable public/private companies and their valuations for context.

Return your analysis as:

```ts
{
  fundingAssessment: {
    summary: string;
    score: "strong" | "adequate" | "concerning" | "unknown";
    details: string;
  };

  revenueAnalysis: {
    estimatedARR: {
      low: number | null;
      high: number | null;
    };
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
```

Be honest about uncertainty. If data is insufficient, say so clearly rather than fabricating estimates.

- **Tools**: `webSearch` (for additional targeted financial searches if needed)
- **Input**: `CompanyProfile`
- **Output**: `FinancialAnalysis`

### 🏷️ Brand & Market Agent

- **Name**: `brand-market-agent`
- **System Prompt**:
You are a brand strategist and market analyst. You receive a structured CompanyProfile and must produce a brand and market positioning analysis.

Your analysis should cover:

1. **Brand Positioning**: How does the company position itself? What's their value proposition?
2. **Market Positioning**: Where do they sit in the competitive landscape? Leader, challenger, niche?
3. **Competitive Analysis**: Detailed comparison with top 3-5 competitors. Strengths and weaknesses.
4. **Sentiment Analysis**: What's the overall market/public sentiment? Based on news, reviews, social signals.
5. **Brand Risks**: Reputation risks, PR issues, negative signals.
6. **Growth Signals**: Hiring patterns, product launches, market expansion indicators.

Return your analysis as:

```ts
{
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
```

- **Tools**: `webSearch` (for additional targeted brand/market searches)
- **Input**: `CompanyProfile`
- **Output**: `BrandMarketAnalysis`

### 🧪 QA Agent (Validator)

- **Name**: `qa-validator-agent`
- **System Prompt**:
You are a senior quality assurance analyst and fact-checker at a deal intelligence firm. You receive:
- The original CompanyProfile (structured data)
- The Financial Analysis
- The Brand & Market Analysis

Your job is to:

1. **Cross-validate**: Do the financial and brand analyses align with the underlying data? Flag contradictions.
2. **Confidence audit**: Review confidence scores. Are they justified? Adjust if needed.
3. **Evidence check**: Does every major claim have a source? Flag unsupported claims.
4. **Gap analysis**: What critical information is missing? What would significantly improve the analysis?
5. **Contradiction detection**: Do the financial and brand analyses contradict each other?
6. **Overall quality score**: Rate the overall reliability of the intelligence package.

Return your validation as:

```ts
{
  overallQualityScore: number; // 0.0 to 1.0
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
```

Set requiresRerun to true ONLY if there are critical gaps that would make the report misleading. Include specific rerunInstructions for what the Ingestion Agent should search for.

- **Tools**: None (pure reasoning and validation)
- **Input**: `CompanyProfile` + `FinancialAnalysis` + `BrandMarketAnalysis`
- **Output**: `QAValidation`

### 📝 Report Agent

- **Name**: `report-agent`
- **System Prompt**:
You are a senior analyst who writes executive intelligence briefings. You receive all analysis outputs and the QA validation, and must produce a polished, structured report.

The report should be in Markdown format with the following structure:

> # Company Intelligence Report: [Company Name]
>
> *Generated by Pythia on [date] | Overall Confidence: [score from QA]*
>
> ## Executive Summary
>
> 3-4 sentence overview of the company and key findings.
>
> ## Company Overview
>
> Basic facts: what they do, when founded, where based, how big, key people.
>
> ## Financial Analysis
>
> Funding, revenue estimates, market size, financial health.
> Each major claim should have an inline confidence indicator:
>
> - 🟢 High
> - 🟡 Medium
> - 🔴 Low
>
> ## Market & Brand Position
>
> Positioning, competitive landscape, sentiment, growth signals.
>
> ## Risk Assessment
>
> Combined financial and brand risks, ranked by severity.
>
> ## Key Findings & Recommendations
>
> Top 5 most important takeaways.
>
> ## Data Quality Notes
>
> Transparency section: what data was available, what was missing, overall reliability.
>
> ## Sources
>
> Numbered list of all sources used.

Guidelines:

- Be concise but thorough.
- Use confidence indicators (🟢🟡🔴) inline with claims.
- Never present uncertain information as fact.
- Include source references as [1], [2], etc.
- The tone should be professional, analytical, and balanced.
- **Tools**: None
- **Input**: `CompanyProfile` + `FinancialAnalysis` + `BrandMarketAnalysis` + `QAValidation`
- **Output**: Markdown string (the report)

### 💬 Chat Agent

- **Name**: `chat-agent`
- **System Prompt**:
You are Pythia, an AI deal intelligence analyst. You have just completed a comprehensive analysis of a company, and the user wants to ask follow-up questions.

You have access to the full analysis data (provided in your context). When answering:

1. ONLY use information from the collected data and analysis. Do not make up facts.
2. Always reference which part of the analysis your answer comes from.
3. If the user asks something not covered by the data, say so honestly and suggest what additional research could help.
4. Be conversational but professional.
5. If asked for opinions, frame them as "based on the available data" rather than absolute statements.

The user may ask things like:

- "What's their biggest risk?"
- "How do they compare to [competitor]?"
- "Is this a good investment?"
- "What data are you least confident about?"
- "Tell me more about their funding history"
- **Tools**: None (grounded in context from previous agents)
- **Input**: Full context from all previous agents (injected into system prompt or message history)
- **Output**: Conversational responses

---

## Data Pipeline

```
  Company Name / URL
         │
         ▼
  ┌─────────────────────────────────┐   ┌─────────────────────────┐
  │  Stage 1: Raw Collection        │◀──│   requiresRerun = true  │
  │  Ingestion Agent                │   └─────────────────────────┘
  └────────────────┬────────────────┘              ▲
                   │                               │
                   ▼                               │
       RawIngestionResult (8–15 sources)           │
                   │                               │
                   ▼                               │
  ┌─────────────────────────────────┐              │
  │  Stage 2: Cleaning & Structuring│              │
  │  Data Engineer Agent            │              │
  └────────────────┬────────────────┘              │
                   │                               │
                   ▼                               │
       CompanyProfile with provenance metadata     │
                   │                               │
                   ▼                               │
  ┌─────────────────────────────────┐              │
  │  Stage 3: Parallel Analysis     │              │
  └───────┬─────────────────┬───────┘              │
          │                 │                      │
          ▼                 ▼                      │
  ┌───────────────┐  ┌──────────────────┐          │
  │   Financial   │  │ Brand & Market   │          │
  │   Analysis    │  │    Analysis      │          │
  └───────┬───────┘  └──────┬───────────┘          │
          └─────────────────┘                      │
                   │                               │
                   ▼                               │
          Combined Analysis                        │
                   │                               │
                   ▼                               │
  ┌─────────────────────────────────┐              │
  │  Stage 4: Validation & QA       │──────────────┘
  │  QA Agent                       │
  └────────────────┬────────────────┘
                   │ requiresRerun = false
                   ▼
          ┌─────────────────┐
          │    Report        │
          │   Generation     │
          └─────────────────┘
```



### Stage 1: Raw Collection (Ingestion Agent)

1. Input company name / URL.
2. Run web searches (Tavily), for example:
  - `[company] funding rounds`
  - `[company] revenue employees`
  - `[company] competitors`
  - `[company] news 2024`
  - `[company] reviews glassdoor`
3. In parallel:
  - Scrape selected URLs and collect structured search snippets (Tavily).
4. Merge outputs into `RawIngestionResult` (8-15 diverse sources).

### Stage 2: Cleaning & Structuring (Data Engineer Agent)

1. Take `RawIngestionResult` as input.
2. Perform LLM-powered extraction and normalization:
  - Entity extraction (names, dates, amounts, roles)
  - Deduplication across sources
  - Format normalization (dates -> ISO, currency -> USD)
  - Temporal tagging (data freshness)
  - Source reliability scoring
  - Contradiction detection
  - Gap identification
3. Output `CompanyProfile` (JSON) with provenance metadata.

### Stage 3: Parallel Analysis (Financial + Brand Agents)

1. Use `CompanyProfile` as shared input.
2. Run in parallel:
  - Financial Analysis
  - Brand and Market Analysis
3. Merge both into `Combined Analysis`.

### Stage 4: Validation & Quality Assurance (QA Agent)

1. Validate `Combined Analysis` with QA checks:
  - Cross-validation
  - Confidence auditing
  - Evidence checking
  - Gap analysis
  - Contradiction detection
2. Branch on result:
  - If `requiresRerun = true`, route back to Supervisor (max 1 retry).
  - If `requiresRerun = false`, continue to report generation.

---

## Data Schema

All TypeScript types used across the system:

```typescript
// === Ingestion Agent Output ===
interface RawSource {
  url: string;
  title: string;
  content: string;
  sourceType: "website" | "news" | "social" | "financial" | "review";
  dateAccessed: string; // ISO
  datePublished: string | null;
}

interface RawIngestionResult {
  companyName: string;
  inputUrl: string | null;
  officialWebsite: string | null;
  rawSources: RawSource[];
}

// === Data Engineer Agent Output ===
interface ConfidenceValue<T> {
  value: T;
  confidence: number; // 0.0 - 1.0
  sources: string[];
}

interface FundingRound {
  type: string;
  amount: number | null;
  date: string | null;
  investors: string[];
  confidence: number;
  sources: string[];
}

interface CompanyProfile {
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
interface FinancialAnalysis {
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
interface BrandMarketAnalysis {
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
interface QAValidation {
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

// === Full Analysis State (passed through workflow) ===
interface PythiaAnalysisState {
  input: { companyName: string; url?: string };
  ingestion: RawIngestionResult | null;
  companyProfile: CompanyProfile | null;
  financialAnalysis: FinancialAnalysis | null;
  brandMarketAnalysis: BrandMarketAnalysis | null;
  qaValidation: QAValidation | null;
  report: string | null; // Markdown
  status: "idle" | "ingesting" | "cleaning" | "analyzing" | "validating" | "generating_report" | "complete" | "error";
  retryCount: number;
  error: string | null;
}
```

## Mastra Implementation Details

### Agent Definitions

```typescript
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

// Each agent is defined as a Mastra Agent with its system prompt and tools

const ingestionAgent = new Agent({
  name: "ingestion-agent",
  instructions: `...`, // Full system prompt from Agent Definitions section above
  model: openai("gpt-4o"),
  tools: {
    webSearch: tavilySearchTool,
  },
});

const dataEngineerAgent = new Agent({
  name: "data-engineer-agent",
  instructions: `...`,
  model: openai("gpt-4o"),
});

const financialAnalystAgent = new Agent({
  name: "financial-analyst-agent",
  instructions: `...`,
  model: openai("gpt-4o"),
  tools: {
    webSearch: tavilySearchTool,
  },
});

const brandMarketAgent = new Agent({
  name: "brand-market-agent",
  instructions: `...`,
  model: openai("gpt-4o"),
  tools: {
    webSearch: tavilySearchTool,
  },
});

const qaValidatorAgent = new Agent({
  name: "qa-validator-agent",
  instructions: `...`,
  model: openai("gpt-4o"),
});

const reportAgent = new Agent({
  name: "report-agent",
  instructions: `...`,
  model: openai("gpt-4o"),
});

const chatAgent = new Agent({
  name: "chat-agent",
  instructions: `...`, // Dynamic — context injected at runtime
  model: openai("gpt-4o"),
});
```

### Workflow Definition

```typescript
import { Workflow, Step } from "@mastra/core/workflows";
import { z } from "zod";

// Step definitions
const ingestStep = new Step({
  id: "ingest",
  execute: async ({ context }) => {
    const { companyName, url } = context.triggerData;
    const result = await ingestionAgent.generate(
      `Research the company: ${companyName}${url ? ` (website: ${url})` : ""}`
    );
    return { ingestion: JSON.parse(result.text) };
  },
});

const cleanDataStep = new Step({
  id: "clean-data",
  execute: async ({ context }) => {
    const ingestion = context.getStepResult("ingest").ingestion;
    const result = await dataEngineerAgent.generate(
      `Clean and structure this raw company data:\n${JSON.stringify(ingestion)}`
    );
    return { companyProfile: JSON.parse(result.text) };
  },
});

const financialAnalysisStep = new Step({
  id: "financial-analysis",
  execute: async ({ context }) => {
    const profile = context.getStepResult("clean-data").companyProfile;
    const result = await financialAnalystAgent.generate(
      `Analyze the financials of this company:\n${JSON.stringify(profile)}`
    );
    return { financialAnalysis: JSON.parse(result.text) };
  },
});

const brandAnalysisStep = new Step({
  id: "brand-analysis",
  execute: async ({ context }) => {
    const profile = context.getStepResult("clean-data").companyProfile;
    const result = await brandMarketAgent.generate(
      `Analyze the brand and market position of this company:\n${JSON.stringify(profile)}`
    );
    return { brandMarketAnalysis: JSON.parse(result.text) };
  },
});

const qaValidationStep = new Step({
  id: "qa-validation",
  execute: async ({ context }) => {
    const profile = context.getStepResult("clean-data").companyProfile;
    const financial = context.getStepResult("financial-analysis").financialAnalysis;
    const brand = context.getStepResult("brand-analysis").brandMarketAnalysis;
    const result = await qaValidatorAgent.generate(
      `Validate this analysis:\nProfile: ${JSON.stringify(profile)}\nFinancial: ${JSON.stringify(financial)}\nBrand: ${JSON.stringify(brand)}`
    );
    return { qaValidation: JSON.parse(result.text) };
  },
});

const reportGenerationStep = new Step({
  id: "generate-report",
  execute: async ({ context }) => {
    const profile = context.getStepResult("clean-data").companyProfile;
    const financial = context.getStepResult("financial-analysis").financialAnalysis;
    const brand = context.getStepResult("brand-analysis").brandMarketAnalysis;
    const qa = context.getStepResult("qa-validation").qaValidation;
    const result = await reportAgent.generate(
      `Generate the intelligence report:\nProfile: ${JSON.stringify(profile)}\nFinancial: ${JSON.stringify(financial)}\nBrand: ${JSON.stringify(brand)}\nQA: ${JSON.stringify(qa)}`
    );
    return { report: result.text };
  },
});

// Workflow assembly
const pythiaWorkflow = new Workflow({
  name: "pythia-analysis",
  triggerSchema: z.object({
    companyName: z.string(),
    url: z.string().optional(),
  }),
})
  .step(ingestStep)
  .then(cleanDataStep)
  .then(financialAnalysisStep)
  .then(brandAnalysisStep)
  .after([financialAnalysisStep, brandAnalysisStep])
  .step(qaValidationStep)
  .then(reportGenerationStep)
  .commit();
```

### Tool Definitions

### Mastra Instance Registration

```typescript
import { Mastra } from "@mastra/core";

const mastra = new Mastra({
  agents: {
    ingestionAgent,
    dataEngineerAgent,
    financialAnalystAgent,
    brandMarketAgent,
    qaValidatorAgent,
    reportAgent,
    chatAgent,
  },
  workflows: {
    pythiaAnalysis: pythiaWorkflow,
  },
});

export { mastra };
```

## Frontend Specification

### Pages & Routes


| Route            | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `/`              | Landing page with company input form                     |
| `/analysis/[id]` | Analysis view with agent activity feed, report, and chat |


### UI Layout for /analysis/[id]

```
┌────────────────────────────────────────────────────────┐
│   Header: Pythia | New Search | Analyzing: Company     │
└────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│   Agent Activity Panel                                 │
│   (agent status + timings)                             │
└───────────────────────┬────────────────────────────────┘
                        │
            ┌───────────┴──────────┐
            ▼                      ▼
┌─────────────────────┐  ┌─────────────────────────────┐
│   Report Viewer     │  │       Chat Panel            │
│ summary, financials │  │  Q&A with grounded sources  │
│   market, risks     │  │                             │
└─────────────────────┘  └─────────────────────────────┘
```



### Key UI Components

1. `**CompanyInput**` — Search bar with company name input and optional URL field. Submit triggers the workflow.
2. `**AgentActivityFeed**` — Real-time feed showing which agent is active, completed, or queued. Each row shows agent name, status icon, and timing. Updates via polling or server-sent events.
3. `**ReportViewer**` — Renders the Markdown report with styled confidence indicators (🟢🟡🔴). Collapsible sections. Source links are clickable.
4. `**ChatPanel**` — Chat interface for conversational Q&A. Messages are grounded in collected data. Shows source references inline.
5. `**ConfidenceBadge**` — Reusable component: `<ConfidenceBadge score={0.82} />` renders as colored badge with score.

### State Management

- Use React state + polling for MVP (poll /api/analysis/[id]/status every 2 seconds)
- The API returns the current PythiaAnalysisState which drives all UI updates
- When status === "complete", stop polling and render the full report + enable chat

### Styling

- Tailwind CSS
- Dark theme preferred (feels like an intelligence/analyst tool)
- Monospace font for data/numbers
- Clean, minimal layout — the data is the hero

## Project Structure

```
pythia/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── analysis/[id]/page.tsx
│   │   └── api/
│   │       ├── analyze/route.ts
│   │       ├── analysis/[id]/status/route.ts
│   │       ├── analysis/[id]/chat/route.ts
│   │       └── mastra/
│   ├── mastra/
│   │   ├── index.ts
│   │   ├── agents/
│   │   │   ├── ingestion.ts
│   │   │   ├── data-engineer.ts
│   │   │   ├── financial-analyst.ts
│   │   │   ├── brand-market.ts
│   │   │   ├── qa-validator.ts
│   │   │   ├── report.ts
│   │   │   └── chat.ts
│   │   ├── tools/
│   │   │   ├── web-search.ts
│   │   │   └── scrape-url.ts
│   │   └── workflows/
│   │       └── pythia-analysis.ts
│   ├── components/
│   │   ├── company-input.tsx
│   │   ├── agent-activity-feed.tsx
│   │   ├── report-viewer.tsx
│   │   ├── chat-panel.tsx
│   │   └── confidence-badge.tsx
│   ├── lib/
│   │   └── types.ts
│   └── styles/
│       └── globals.css
├── .env.local
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
└── README.md
```



## Key Design Principles

1. **Transparency over polish** — Every claim has a confidence score and source. The QA section is visible, not hidden. Users should trust the tool because it shows its work.
2. **Graceful degradation** — If an agent fails or data is sparse, the system still produces a report with clear "insufficient data" markers rather than crashing or hallucinating.
3. **Visible orchestration** — The agent activity feed isn't just a loading spinner. It shows the multi-agent collaboration in real time, which is both useful and impressive for demos.
4. **Grounded chat** — The chat agent ONLY uses collected data. It should refuse to speculate beyond what the analysis found, maintaining trust.
5. **Idempotent and stateless** — Each analysis run is independent. No persistent database needed for MVP. State lives in the workflow execution.


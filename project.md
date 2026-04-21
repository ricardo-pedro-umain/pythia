# Pythia — AI-Powered Deal Intelligence Platform

> "What if a junior analyst team worked overnight on any company you threw at them, and had a briefing ready by morning?"

Pythia is named after the ancient Greek oracle at Delphi. Feed it a company name, and a team of AI agents investigates, cleans, analyzes, cross-validates, and delivers a comprehensive intelligence briefing you can interrogate conversationally.

This document describes the **MVP as implemented**. It is the authoritative description of what the code does today; the aspirational notes that used to live here have been moved into scope discussions.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Agents & Tools](#agents--tools)
5. [Data Pipeline](#data-pipeline)
6. [Data Schema](#data-schema)
7. [Mastra Implementation Details](#mastra-implementation-details)
8. [Frontend Specification](#frontend-specification)
9. [Testing & Evals](#testing--evals)
10. [Project Structure](#project-structure)
11. [Key Design Principles](#key-design-principles)

---

## Overview

Pythia is an end-to-end multi-agent application that performs automated company due diligence. A user types a company name (optionally with a URL). If the name is ambiguous, Pythia shows candidate companies to pick from. A workflow of specialized components — one deterministic ingestion runner and five LLM agents — then produces a confidence-scored Markdown report plus a chat interface grounded in the collected data. All progress streams live to the UI via Server-Sent Events.

### Core Capabilities

- **Multi-agent orchestration** with sequential, parallel, and conditional-retry branches
- **Confidence scoring & evidence chains** — every claim links back to its source URL and carries a reliability score
- **Adaptive re-runs** — when the QA agent flags critical gaps, the pipeline re-ingests with targeted queries and re-analyzes (capped at one retry)
- **Interactive chat** grounded in collected data
- **Visible orchestration** — each pipeline step is rendered live in the UI with elapsed-time indicators
- **Company disambiguation** — a lightweight pre-analysis step that catches name collisions (e.g. "Apple" the computer company vs. "Apple" the record label)
- **Multi-analysis history** — every run is persisted to SQLite and listable in the UI

---

## Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| **Agent framework** | [Mastra](https://mastra.ai/) `@mastra/core` | TypeScript agents + workflows with structured output |
| **LLM** | OpenAI GPT-4o via `@ai-sdk/openai` | Primary model for all agents |
| **Search** | [Tavily](https://tavily.com/) `@tavily/core` | Used by the deterministic ingestion runner and by the disambiguation route |
| **Backend** | Next.js 16 App Router + API routes | Note: this project uses Next 16's breaking-change API — read `node_modules/next/dist/docs/` before making framework-level changes |
| **Frontend** | React 19 + Tailwind CSS 4 | Single app, no separate backend deployment |
| **Storage** | SQLite via `better-sqlite3` with WAL mode | A single `.data/analyses.sqlite` file; atomic read-modify-write via synchronous transactions |
| **Live updates** | Server-Sent Events | In-process `EventEmitter` pub/sub keyed by analysis id |
| **PDF export** | `html2canvas-pro` + `jspdf` | Client-side PDF generation from the rendered report |
| **Runtime schemas** | Zod | Used by Mastra's `structuredOutput` and by a defensive fallback parser |
| **Tests** | Vitest | 89 unit tests covering pure helpers, SQLite store, schemas, structured-generate fallback, and eval scorers |
| **Evals** | Custom harness (`tsx` + Vitest-style scorers) | Opt-in; drives the real workflow against a fixture pack and emits a Markdown report |

### Required API keys

- `OPENAI_API_KEY` — for GPT-4o
- `TAVILY_API_KEY` — for web search

Both are validated lazily via a Proxy in `src/lib/env.ts`. Missing keys throw a descriptive error at first use rather than at build time, so `next build` still runs on a machine without secrets.

---

## Architecture

```
┌──────────────────────────────────────┐
│           User Interface             │
│         (Next.js App Router)         │
└──────────────────┬───────────────────┘
                   │ fetch + SSE
                   ▼
┌─────────────────────────────────────────────────────┐
│                Next.js API routes                   │
│  /api/disambiguate — pick the right company         │
│  /api/analyze      — create row + kick off workflow │
│  /api/analysis/:id/{status,stream,chat}             │
│  /api/analyses     — list history                   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼───────────────────┐   ┌──────────────────────┐
│        Mastra Workflow               │◀──│  SQLite store        │
│        pythiaWorkflow                │──▶│  (persistence)       │
└───┬───────────────┬───────────────┬──┘   └──────────┬───────────┘
    │               │               │                 │
    ▼               ▼               ▼                 ▼
┌───────────┐ ┌────────────┐ ┌──────────────────┐  EventEmitter
│ Ingestion │ │  Data      │ │ Financial +      │  pub/sub
│ runner    │ │  Engineer  │ │ Brand (parallel) │  (→ SSE clients)
│ (code,    │ │  (LLM)     │ │   (LLM × 2)      │
│ not LLM)  │ └──────┬─────┘ └────────┬─────────┘
└─────┬─────┘        │                │
      └──────────────┼────────────────┘
                     ▼
            ┌──────────────────┐
            │  QA Validator    │── requiresRerun ─┐
            │      (LLM)       │                  │
            └────────┬─────────┘                  │
                     │ no retry                   │
                     ▼                            ▼
            ┌──────────────────┐   ┌──────────────────────────┐
            │  Report Agent    │   │  Conditional Retry       │
            │     (LLM)        │   │  (re-ingest + re-analyze │
            └────────┬─────────┘   │   with gap queries,      │
                     │             │   max 1 iteration)       │
                     ▼             └──────────┬───────────────┘
             Markdown report                  │
                     │                        │
                     └── merges back ─────────┘

Chat agent (LLM, separate route): answers follow-up questions
grounded in the analysis state for any completed run.
```

### Orchestration flow

1. User submits a company name (+ optional URL). The `/api/disambiguate` route runs a quick Tavily search and, if the name is ambiguous, returns 2-4 candidates for the user to choose between. Clear cases (e.g. "Tesla" → tesla.com dominates) skip straight through.
2. `/api/analyze` creates a row in SQLite and calls `pythiaWorkflow.createRun().start(...)` without awaiting — the POST returns the analysis id immediately. The workflow runs in the background.
3. The **ingestion runner** (pure code) fires the canonical 8-query search panel at Tavily in parallel, deduplicates by URL, and persists a `RawIngestionResult`.
4. The **data engineer** agent turns raw sources into a structured `CompanyProfile`, using Mastra's `structuredOutput` to get a zod-validated object directly.
5. The **financial analyst** and **brand & market** agents run in parallel (`.parallel([...])`) on the same profile.
6. The **QA validator** cross-checks all three analyses. If it sets `requiresRerun: true` with instructions, the **conditional retry** step re-ingests with gap-filling queries and re-runs clean → analyze → validate once more. Otherwise the retry step is a passthrough.
7. The **report agent** synthesizes the Markdown briefing.
8. The **chat agent** (separate HTTP route, not part of the workflow) answers follow-up questions at any point after ingestion, grounded in the persisted analysis state.

### Handoff patterns

| Pattern | Where |
| --- | --- |
| **Deterministic stage** | Ingestion (pure Tavily code, no LLM) |
| **Sequential** | Ingestion → clean-data → (parallel analysis) → QA → retry? → report |
| **Fan-out / fan-in** | `.parallel([financialAnalysisStep, brandAnalysisStep])` |
| **Conditional feedback loop** | QA's `requiresRerun` flag → `conditionalRetryStep` → re-ingest + re-analyze, max 1 iteration |
| **Persistence bus** | Every step calls `updateAnalysis(id, …)`, which commits to SQLite and emits on the in-process EventEmitter |
| **Live fan-out** | SSE handlers subscribe to `analysis:<id>` events, forward to connected browser tabs |
| **Grounded handoff** | Chat agent reads the persisted `PythiaAnalysisState` as its context |

---

## Agents & Tools

### 🧹 Ingestion (deterministic runner — NOT an agent)

- **File**: `src/mastra/tools/ingestion-runner.ts`
- **Why not an LLM?** The original plan had an ingestion *agent* with a `webSearch` tool. In practice, giving the LLM latitude over what to search produced unstable panel coverage and burned tokens on orchestration it didn't need. The canonical 8-query panel is now hard-coded and fires in parallel; the saved tokens and latency go toward the downstream reasoning steps.
- **Canonical search panel** (each query tagged with a `sourceType`):
  - `{c} official website about` → `website`
  - `{c} funding raised valuation investors` → `financial`
  - `{c} revenue ARR employees headcount {y}` → `financial`
  - `{c} CEO founder leadership team` → `website`
  - `{c} product launch news {y}` → `news`
  - `{c} competitors market share industry` → `news`
  - `{c} reviews employees culture glassdoor` → `review`
  - `{c} crunchbase pitchbook acquisition` → `financial`
- `{y}` is the current calendar year — hardcoded years silently biased results toward stale reporting once the calendar flipped.
- `extraQueries` parameter lets the retry branch inject gap-filling searches derived from the QA's `rerunInstructions`.
- Failures are swallowed individually (`Promise.allSettled`) unless *every* query fails, in which case the caller gets a descriptive error.
- Results are dedup'd by URL (highest-score wins), ranked, and capped at 30.

### 🧹 Data Engineer Agent

- **File**: `src/mastra/agents/data-engineer.ts`
- **Job**: Turn raw Tavily hits into a structured `CompanyProfile` with confidence scores, source URLs, and gap/contradiction metadata.
- **Structured output**: `companyProfileSchema` in `src/mastra/schemas.ts`, validated by the `generateStructured` helper.
- **Tools**: None.

### 📊 Financial Analyst Agent

- **File**: `src/mastra/agents/financial-analyst.ts`
- **Job**: Produce a `FinancialAnalysis` from the `CompanyProfile` — funding assessment, revenue bands, market size, unit economics, risks, comparables.
- **Structured output**: `financialAnalysisSchema`.
- **Tools**: `webSearch` (Tavily) for targeted financial follow-ups.

### 🏷️ Brand & Market Agent

- **File**: `src/mastra/agents/brand-market.ts`
- **Job**: Produce a `BrandMarketAnalysis` from the same profile — positioning, competitive analysis, sentiment, growth signals, brand risks.
- **Structured output**: `brandMarketAnalysisSchema`.
- **Tools**: `webSearch` for targeted brand/market follow-ups.

### 🧪 QA Validator Agent

- **File**: `src/mastra/agents/qa-validator.ts`
- **Job**: Cross-validate profile + financial + brand; flag contradictions, adjust confidences, identify critical gaps, and decide whether to trigger a retry.
- **Structured output**: `qaValidationSchema`.
- **Retry contract**: Sets `requiresRerun: true` plus a `rerunInstructions` string when gaps are critical. The conditional retry step splits that string into extra ingestion queries and runs ingestion → clean → analyze → validate once more, with a `(this is a RETRY — be lenient on gaps that were already flagged)` preamble to prevent infinite loops.

### 📝 Report Agent

- **File**: `src/mastra/agents/report.ts`
- **Job**: Produce the final Markdown briefing from the four prior outputs. Includes confidence indicators (🟢 🟡 🔴) inline with claims.
- **Tools**: None.

### 💬 Chat Agent

- **File**: `src/mastra/agents/chat.ts`
- **Job**: Answer follow-up questions, grounded exclusively in the persisted analysis state.
- **Wiring**: Served by `/api/analysis/[id]/chat`. Each turn appends user + assistant messages to the analysis row atomically via the updater-function overload of `updateAnalysis`.
- **Tools**: None.

### 🔧 Web Search Tool

- **File**: `src/mastra/tools/web-search.ts`
- Used by financial and brand agents (the ingestion runner uses the Tavily SDK directly).

### 🔎 Disambiguation (HTTP route, not part of the workflow)

- **File**: `src/lib/disambiguate.ts` + `src/app/api/disambiguate/route.ts`
- Runs two parallel Tavily queries for the typed name, filters out reference sites (wikipedia, crunchbase, bloomberg, …), dedupes by root domain, and applies two confidence gates:
  1. If the top result dominates (`topScore ≥ 0.6` AND `topScore ≥ 1.6 × secondScore`) → no disambiguation.
  2. If all surviving candidates resolve to the same company (e.g. "xAI" / "xAI Corp") → no disambiguation.
- Otherwise returns up to 4 candidates for the UI to display. Pure heuristics, fully unit-tested (see `src/lib/disambiguate.test.ts`).

---

## Data Pipeline

```
    Company Name / URL
           │
           ▼
┌──────────────────────────────┐
│  Pre-flight: Disambiguation  │    (no LLM — pure Tavily + heuristics)
│    /api/disambiguate         │
└──────────────┬───────────────┘
               │ user picks or passes through
               ▼
┌──────────────────────────────┐
│  Stage 1: Ingestion Runner   │◀─── extraQueries from QA retry
│  (pure code, 8 Tavily calls) │
└──────────────┬───────────────┘
               ▼
     RawIngestionResult  (≤ 30 dedup'd sources)
               │
               ▼
┌──────────────────────────────┐
│  Stage 2: Data Engineer LLM  │
│  → zod-validated profile     │
└──────────────┬───────────────┘
               ▼
        CompanyProfile (with confidence/source per field)
               │
               ▼
┌──────────────────────────────┐
│  Stage 3: Parallel Analysis  │
│  Financial  +  Brand/Market  │   .parallel([…])
└──────┬───────────────┬───────┘
       │               │
       └───────┬───────┘
               ▼
┌──────────────────────────────┐
│  Stage 4: QA Validation      │── requiresRerun = true ─┐
└──────────────┬───────────────┘                         │
               │ no                                      │
               ▼                                         ▼
┌──────────────────────────────┐   ┌────────────────────────────────┐
│  Stage 5: Report generation  │   │  Conditional retry             │
│  → Markdown                  │   │  re-ingest with extra queries, │
└──────────────┬───────────────┘   │  re-run clean/analyze/QA once  │
               ▼                   └──────────────┬─────────────────┘
          Persisted + streamed                    │
          to the UI                               │
                                   ◀──────────────┘
```

Every stage calls `updateAnalysis(id, patch)`, which commits to SQLite *inside* a transaction and emits on the EventEmitter. SSE clients subscribed to `analysis:<id>` see each transition live. Step durations (`stepDurations`) are recorded via the updater-function overload so parallel steps can't clobber each other's entries.

---

## Data Schema

All TypeScript types live in `src/lib/types.ts`; the matching Zod schemas live in `src/mastra/schemas.ts`.

```ts
// === Raw ingestion ===
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

// === Shared fragments ===
interface ConfidenceValue<T> {
  value: T;
  confidence: number; // 0..1
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

// === Company profile (data engineer output) ===
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
  competitors: Array<{ name: string; overlap: string; confidence: number; sources: string[] }>;
  techStack: Array<{ technology: string; confidence: number; source: string }>;
  keyPeople: Array<{ name: string; role: string; confidence: number; source: string }>;
  recentNews: Array<{
    title: string; summary: string; date: string; url: string;
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

// === Financial analyst output === (see src/lib/types.ts for the full shape)
// === Brand & market output ===      …
// === QA output ===                   …

// === Persisted analysis row ===
interface PythiaAnalysisState {
  input: { companyName: string; url?: string };
  ingestion: RawIngestionResult | null;
  companyProfile: CompanyProfile | null;
  financialAnalysis: FinancialAnalysis | null;
  brandMarketAnalysis: BrandMarketAnalysis | null;
  qaValidation: QAValidation | null;
  report: string | null; // Markdown
  status:
    | "idle" | "ingesting" | "cleaning" | "analyzing"
    | "validating" | "generating_report" | "complete" | "error";
  retryCount: number;
  error: string | null;
  createdAt: string; // ISO
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Duration in ms of each completed pipeline step, keyed by status name. */
  stepDurations: Partial<Record<
    "ingesting" | "cleaning" | "analyzing" | "validating" | "generating_report",
    number
  >>;
}
```

The Zod schemas and TypeScript types are maintained manually in lockstep. A fixture-based round-trip test (`src/mastra/schemas.test.ts`) catches shape drift.

---

## Mastra Implementation Details

### Structured output helper

Mastra exposes `structuredOutput: { schema }` on `agent.generate()`. In practice models occasionally return a validly-shaped `.object` with an empty `.text`, or the reverse, or fence their JSON with ```` ```json ... ``` ````. The `generateStructured` helper in `src/mastra/lib/structured-generate.ts` normalizes all three cases:

1. Prefer the parsed `.object` if it validates against the schema.
2. Otherwise strip code fences from `.text`, `JSON.parse`, and validate.
3. If neither path yields a valid object, throw a descriptive error naming the agent.

### Shared pipeline primitives

`src/mastra/lib/pipeline.ts` exposes `runCleanData`, `runFinancial`, `runBrand`, `runParallelAnalysis`, and `runValidation`. Each does the LLM call, schema validation, and `updateAnalysis` persistence, and returns `{ object, text }`. Both the main workflow's steps and the conditional retry branch use these primitives — so a prompt tweak is a one-file change.

### Typed agent lookup

`src/mastra/lib/agents.ts` exports an `AGENT_IDS` const and a `getAgent(mastra, "brandMarket")` helper. Misspellings become TypeScript errors instead of runtime `undefined`s.

### Workflow definition (sketch)

```ts
// src/mastra/workflows/pythia-analysis.ts
export const pythiaWorkflow = createWorkflow({
  id: "pythia-analysis",
  inputSchema: z.object({
    companyName: z.string(),
    url: z.string().optional(),
    analysisId: z.string(),
  }),
  outputSchema: z.object({ text: z.string() }),
  steps: [
    ingestStep,
    cleanDataStep,
    financialAnalysisStep,
    brandAnalysisStep,
    qaValidationStep,
    conditionalRetryStep,
    reportGenerationStep,
  ],
})
  .then(ingestStep)
  .then(cleanDataStep)
  .parallel([financialAnalysisStep, brandAnalysisStep])
  .then(qaValidationStep)
  .then(conditionalRetryStep)
  .then(reportGenerationStep)
  .commit();
```

Each step calls `updateAnalysis(id, { status: "…" })` on entry, runs its pipeline primitive, records `stepDurations` via the updater-function overload, and returns the shared payload shape.

### Store & streaming

`src/lib/store.ts` wraps `better-sqlite3` with:

- Prepared statements cached at module scope
- A synchronous transaction around every `updateAnalysis` (read-modify-write can't race)
- An **updater-function overload** so parallel steps can safely merge nested objects: `updateAnalysis(id, prev => ({ stepDurations: { ...prev.stepDurations, foo: 123 } }))`
- A module-level `EventEmitter` — `subscribeAnalysis(id, listener)` is what the SSE route calls

Next.js hot reloading preserves the DB handle and event bus via globalThis-stashed singletons.

### Timeouts

The `/api/analyze` route wraps `run.start(…)` in `Promise.race` against a 15-minute timeout, so a stuck upstream API never leaves a row permanently "in progress".

---

## Frontend Specification

### Pages & routes

| Route | Description |
| --- | --- |
| `/` | Landing page: company input + disambiguation flow + recent analyses |
| `/analyses` | Full list of past analyses |
| `/analysis/[id]` | Live agent pipeline, Markdown report, chat, PDF download |

### API routes

| Route | Purpose |
| --- | --- |
| `POST /api/disambiguate` | Returns up to 4 candidates (or `[]` if unambiguous) |
| `POST /api/analyze` | Creates a row and starts the workflow. Returns `{ id }` immediately. |
| `GET /api/analysis/[id]/status` | Current `PythiaAnalysisState`. Used for non-streaming fallback. |
| `GET /api/analysis/[id]/stream` | SSE stream of state updates for this id. |
| `POST /api/analysis/[id]/chat` | Chat turn. Atomically appends user + assistant messages. |
| `GET /api/analyses` | List of all rows (id, name, status, createdAt) for the sidebar. |

### Key components

| Component | Role |
| --- | --- |
| `components/company-input.tsx` | Input form with disambiguation candidates |
| `components/agent-activity-feed.tsx` | Live per-step status with elapsed-time timer and final durations |
| `components/report-viewer.tsx` | Renders the Markdown report with confidence badges |
| `components/chat-panel.tsx` | Grounded Q&A. Input sits near hints when empty and expands with conversation. |
| `components/recent-analyses.tsx` | Recent-runs sidebar/list |
| `components/confidence-badge.tsx` | `<ConfidenceBadge score={0.82} />` — colored pill |

### State management

- SSE is primary: `EventSource("/api/analysis/:id/stream")`.
- `GET /api/analysis/:id/status` is the one-shot fallback when the tab is opened mid-run.
- Once `status === "complete"`, the UI stops subscribing and renders the report + enables chat.

### Styling & UX

- Tailwind 4 dark theme — the "intelligence terminal" aesthetic.
- Monospace font for numeric/structured data.
- PDF export uses `html2canvas-pro` to snapshot the report viewer and `jspdf` to produce a download — purely client-side, no server roundtrip.

---

## Testing & Evals

### Unit tests — `npm test`

Vitest, Node environment, 89 tests in ~180ms. Covers:

- **`src/lib/disambiguate.test.ts`** — every pure helper (`norm`, `getRootDomain`, `domainMatchesTerm`, `titleToName`, `isSameCompany`, `isCloseEnough`) plus orchestration with a mocked Tavily client (Tesla dominance, Apple vs. Apple Records, xAI same-entity collapse, reference-site filtering).
- **`src/lib/store.test.ts`** — CRUD, both `updateAnalysis` overloads including the explicit race test for the updater form, listing, delete, pub/sub. Each test uses a temp directory via `process.cwd` rebind + `vi.resetModules()` so the SQLite singleton is fresh.
- **`src/mastra/schemas.test.ts`** — fixture round-trip through all four Zod schemas plus negative cases (wrong enums, missing keys, wrong types).
- **`src/mastra/lib/structured-generate.test.ts`** — prefer-`.object`, fallback-to-`.text`, fence stripping, invalid-object falls through to text, JSON parse errors, schema validation errors, empty responses.
- **`evals/scorers.test.ts`** — unit tests for every eval scorer, deliberately runnable in the default test pass so a scorer refactor fails `npm test` before you burn money on a real eval run.

### Evals — `npm run evals`

Opt-in harness at `evals/`. Drives the full `pythiaWorkflow` against a fixture pack (famous / recently-funded / obscure company archetypes) and scores each run with six deterministic scorers:

| Scorer | What it checks |
| --- | --- |
| `schemaValid` | All four structured outputs round-trip through their schemas. **Hard gate** (non-zero exit on failure). |
| `sourcesCount` | Data engineer retained enough sources (≥ 8 for famous, ≥ 3 for obscure). |
| `confidenceVariance` | Confidence values show healthy spread — not uniform filler. |
| `wellKnownBackfill` | Fixture-specific hints (founded year, HQ, competitors) show up in the profile. |
| `gracefulDegradation` | On obscure fixtures, the output has low confidence + declared gaps (inverts the usual polarity — hallucinated certainty is the failure mode). |
| `qaAlignment` | The QA validator's own quality score as a first-class signal. |

Writes a Markdown report to `evals/reports/<timestamp>.md`. `EVAL_FILTER=stripe,anthropic` filters to specific fixtures for iteration.

---

## Project Structure

```
pythia/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                          # Landing + recent analyses
│   │   ├── globals.css
│   │   ├── analyses/page.tsx                 # Full history
│   │   ├── analysis/[id]/page.tsx            # Live run + report + chat
│   │   └── api/
│   │       ├── analyses/route.ts             # GET list
│   │       ├── analyze/route.ts              # POST → kick off workflow
│   │       ├── disambiguate/route.ts         # POST → candidates
│   │       └── analysis/[id]/
│   │           ├── _helpers.ts
│   │           ├── status/route.ts           # GET current state
│   │           ├── stream/route.ts           # SSE
│   │           └── chat/route.ts             # POST chat turn
│   ├── components/
│   │   ├── agent-activity-feed.tsx
│   │   ├── chat-panel.tsx
│   │   ├── company-input.tsx
│   │   ├── confidence-badge.tsx
│   │   ├── recent-analyses.tsx
│   │   └── report-viewer.tsx
│   ├── lib/
│   │   ├── disambiguate.ts         + .test.ts
│   │   ├── env.ts
│   │   ├── store.ts                + .test.ts
│   │   └── types.ts
│   └── mastra/
│       ├── index.ts                          # Mastra instance
│       ├── schemas.ts              + .test.ts
│       ├── agents/
│       │   ├── brand-market.ts
│       │   ├── chat.ts
│       │   ├── data-engineer.ts
│       │   ├── financial-analyst.ts
│       │   ├── qa-validator.ts
│       │   └── report.ts
│       ├── lib/
│       │   ├── agents.ts                     # Typed agent getter
│       │   ├── pipeline.ts                   # Shared primitives
│       │   └── structured-generate.ts  + .test.ts
│       ├── prompts/
│       │   └── confidence.ts                 # Shared prompt fragments
│       ├── tools/
│       │   ├── ingestion-runner.ts           # Deterministic Tavily runner
│       │   └── web-search.ts                 # Tool for financial/brand agents
│       └── workflows/
│           └── pythia-analysis.ts
├── evals/
│   ├── fixtures.ts
│   ├── scorers.ts             + .test.ts
│   ├── run-evals.ts
│   ├── tsconfig.json
│   └── README.md
├── .data/                      # SQLite file(s) — gitignored
├── vitest.config.ts
├── AGENTS.md                   # Repo-level agent notes (Next 16 warning)
├── CLAUDE.md                   # Points at AGENTS.md
├── package.json
├── tsconfig.json
├── postcss.config.mjs
├── next.config.ts
└── README.md
```

---

## Key Design Principles

1. **Determinism where it helps, LLM where it helps** — ingestion and disambiguation are pure code, because those stages benefit from predictability and speed more than from reasoning. Cleaning, analysis, validation, and report-writing are agents, because those stages benefit from open-ended reasoning.
2. **Structured output everywhere** — every LLM call that produces data goes through `generateStructured` with a Zod schema. A malformed model response fails loudly instead of silently polluting the state.
3. **Atomic state updates** — `updateAnalysis` wraps every mutation in a SQLite transaction. The updater-function overload means parallel steps (financial + brand) can safely merge nested fields without racing.
4. **Transparency over polish** — Every claim has a confidence score and source list. The QA section is rendered in the report, not hidden. Users should trust the tool because it shows its work.
5. **Graceful degradation** — If a stage produces thin results, the downstream agents receive honest gaps and low confidences rather than confident hallucinations. The `gracefulDegradation` eval scorer pins this behaviour for obscure companies.
6. **Visible orchestration** — The activity feed shows each step transitioning in real time, with elapsed times and final durations. This is both useful as UX and strongly diagnostic when a step hangs.
7. **Grounded chat** — The chat agent reads the persisted analysis state and nothing else. It should refuse to speculate past what the analysis found.
8. **Single-process SSE, not Redis** — The in-process `EventEmitter` is enough for MVP and keeps deployment trivial. Swapping in a real pub/sub layer later is a localized change in `store.ts`.
9. **Local-first persistence** — `.data/analyses.sqlite` keeps the MVP dead-simple to run. A serverless deployment would need to swap the storage layer — SQLite on an ephemeral filesystem is not a production pattern.
10. **Evals as a separate budget** — Unit tests are free and fast and run on every commit. Evals hit real APIs and cost real money, so they live behind an explicit `npm run evals` gate with filterable fixtures.

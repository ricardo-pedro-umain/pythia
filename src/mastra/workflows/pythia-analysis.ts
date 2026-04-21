import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { updateAnalysis } from "@/lib/store";
import type { PythiaAnalysisState } from "@/lib/types";
import { runIngestionSearches } from "../tools/ingestion-runner";
import { getAgent } from "../lib/agents";
import {
  runBrand,
  runCleanData,
  runFinancial,
  runParallelAnalysis,
  runValidation,
} from "../lib/pipeline";

type TimedStepKey = keyof NonNullable<PythiaAnalysisState["stepDurations"]>;

/**
 * Record the elapsed duration (ms) for a pipeline step. Uses max-accumulation
 * so parallel siblings (financial + brand analysis) don't double-count and
 * retry runs don't erase the original reading.
 *
 * The updater-function form of `updateAnalysis` is critical here: parallel
 * steps fire `recordStepDuration` concurrently, so the read-compute-write
 * MUST happen inside the SQLite transaction. A plain partial patch would
 * race — two parallel steps read the same `prior`, each writes its own
 * merged `stepDurations`, and whichever commits second silently clobbers
 * the other's value.
 */
function recordStepDuration(analysisId: string, step: TimedStepKey, ms: number) {
  updateAnalysis(analysisId, (prev) => {
    const prior = prev.stepDurations?.[step] ?? 0;
    return {
      stepDurations: {
        ...(prev.stepDurations ?? {}),
        [step]: Math.max(prior, ms),
      },
    };
  });
}

const workflowInputSchema = z.object({
  companyName: z.string(),
  url: z.string().optional(),
  analysisId: z.string(),
});

type WorkflowInput = z.infer<typeof workflowInputSchema>;

// Step 1: Ingestion — run the canonical Tavily search panel directly in code
// (no LLM). Produces a compact RawIngestionResult, persists it on the
// analysis state, and forwards it as JSON text to the data engineer.
const ingestStep = createStep({
  id: "ingest",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "ingesting" });
    const start = Date.now();

    const ingestion = await runIngestionSearches({
      companyName: inputData.companyName,
      inputUrl: inputData.url ?? null,
    });

    updateAnalysis(analysisId, { ingestion });
    recordStepDuration(analysisId, "ingesting", Date.now() - start);
    return { text: JSON.stringify(ingestion) };
  },
});

// Step 2: Data cleaning — structure raw data into CompanyProfile
const cleanDataStep = createStep({
  id: "clean-data",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "cleaning" });
    const start = Date.now();

    const { text } = await runCleanData(mastra, analysisId, inputData.text);

    recordStepDuration(analysisId, "cleaning", Date.now() - start);
    return { text };
  },
});

// Step 3a: Financial analysis (runs in parallel with brand analysis).
// Mastra's .parallel() needs two distinct step ids, so the "financial" and
// "brand" halves live as separate steps rather than a single combined one.
const financialAnalysisStep = createStep({
  id: "financial-analysis",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "analyzing" });
    const start = Date.now();

    const { text } = await runFinancial(mastra, analysisId, inputData.text);

    recordStepDuration(analysisId, "analyzing", Date.now() - start);
    return { text };
  },
});

// Step 3b: Brand & market analysis (runs in parallel with financial analysis)
const brandAnalysisStep = createStep({
  id: "brand-analysis",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "analyzing" });
    const start = Date.now();

    const { text } = await runBrand(mastra, analysisId, inputData.text);

    recordStepDuration(analysisId, "analyzing", Date.now() - start);
    return { text };
  },
});

// Step 4: QA validation — cross-validate all findings
const qaValidationStep = createStep({
  id: "qa-validation",
  inputSchema: z.object({
    "financial-analysis": z.object({ text: z.string() }),
    "brand-analysis": z.object({ text: z.string() }),
  }),
  outputSchema: z.object({
    text: z.string(),
    companyProfile: z.string(),
    financialAnalysis: z.string(),
    brandAnalysis: z.string(),
    requiresRerun: z.boolean(),
    rerunInstructions: z.string().nullable(),
  }),
  execute: async ({ inputData, mastra, getStepResult, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "validating" });
    const start = Date.now();

    const companyProfile = getStepResult<{ text: string }>("clean-data").text;
    const financial = inputData["financial-analysis"].text;
    const brand = inputData["brand-analysis"].text;

    const { object, text } = await runValidation(mastra, analysisId, {
      profile: companyProfile,
      financial,
      brand,
    });

    recordStepDuration(analysisId, "validating", Date.now() - start);
    return {
      text,
      companyProfile,
      financialAnalysis: financial,
      brandAnalysis: brand,
      requiresRerun: object.requiresRerun,
      rerunInstructions: object.rerunInstructions,
    };
  },
});

// Step 4b: Conditional retry — re-run the analysis portion of the pipeline
// when QA flagged critical gaps. Capped at one retry by design (no recursion).
const conditionalRetryStep = createStep({
  id: "conditional-retry",
  inputSchema: z.object({
    text: z.string(),
    companyProfile: z.string(),
    financialAnalysis: z.string(),
    brandAnalysis: z.string(),
    requiresRerun: z.boolean(),
    rerunInstructions: z.string().nullable(),
  }),
  outputSchema: z.object({
    text: z.string(),
    companyProfile: z.string(),
    financialAnalysis: z.string(),
    brandAnalysis: z.string(),
  }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId, companyName, url } = getInitData<WorkflowInput>();

    // No parse needed — the QA step already emitted the typed booleans.
    if (!inputData.requiresRerun || !inputData.rerunInstructions) {
      return {
        text: inputData.text,
        companyProfile: inputData.companyProfile,
        financialAnalysis: inputData.financialAnalysis,
        brandAnalysis: inputData.brandAnalysis,
      };
    }

    // --- Retry cycle ---
    updateAnalysis(analysisId, { status: "ingesting", retryCount: 1 });

    // Re-run ingestion with targeted gap-filling queries. The rerun
    // instructions are a free-form string from the QA agent; split them
    // into individual queries and pass as extras.
    const extraQueries = inputData.rerunInstructions
      .split(/\n|;|\. /)
      .map((s) => s.trim())
      .filter((s) => s.length > 6)
      .slice(0, 6)
      .map((q) => `${companyName} ${q}`);

    const ingestion = await runIngestionSearches({
      companyName,
      inputUrl: url ?? null,
      extraQueries,
    });
    updateAnalysis(analysisId, { ingestion });

    // Re-run data engineer (merging with the prior profile)
    updateAnalysis(analysisId, { status: "cleaning", retryCount: 1 });
    const cleaned = await runCleanData(
      mastra,
      analysisId,
      JSON.stringify(ingestion),
      inputData.companyProfile
    );

    // Re-run financial + brand concurrently
    updateAnalysis(analysisId, { status: "analyzing", retryCount: 1 });
    const { financial, brand } = await runParallelAnalysis(
      mastra,
      analysisId,
      cleaned.text
    );

    // Re-run QA with the lenient flag so it doesn't immediately demand
    // another retry for the same gaps.
    updateAnalysis(analysisId, { status: "validating", retryCount: 1 });
    const qa = await runValidation(
      mastra,
      analysisId,
      { profile: cleaned.text, financial: financial.text, brand: brand.text },
      true
    );

    return {
      text: qa.text,
      companyProfile: cleaned.text,
      financialAnalysis: financial.text,
      brandAnalysis: brand.text,
    };
  },
});

// Step 5: Report generation — synthesize everything into a Markdown report
const reportGenerationStep = createStep({
  id: "generate-report",
  inputSchema: z.object({
    text: z.string(),
    companyProfile: z.string(),
    financialAnalysis: z.string(),
    brandAnalysis: z.string(),
  }),
  outputSchema: z.object({ text: z.string() }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "generating_report" });
    const start = Date.now();

    const agent = getAgent(mastra, "report");
    const result = await agent.generate(
      `Generate the intelligence report from these analysis outputs:

      Company Profile:
      ${inputData.companyProfile}

      Financial Analysis:
      ${inputData.financialAnalysis}

      Brand & Market Analysis:
      ${inputData.brandAnalysis}

      QA Validation:
      ${inputData.text}`
    );

    recordStepDuration(analysisId, "generating_report", Date.now() - start);
    return { text: result.text };
  },
});

// Assemble the workflow
export const pythiaWorkflow = createWorkflow({
  id: "pythia-analysis",
  inputSchema: workflowInputSchema,
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

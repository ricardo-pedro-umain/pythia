import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { updateAnalysis } from "@/lib/store";

const workflowInputSchema = z.object({
  companyName: z.string(),
  url: z.string().optional(),
  analysisId: z.string(),
});

type WorkflowInput = z.infer<typeof workflowInputSchema>;

// Step 1: Ingestion — gather raw data from web sources
const ingestStep = createStep({
  id: "ingest",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "ingesting" });

    const agent = mastra.getAgent("ingestionAgent");
    const prompt = `Research the company: ${inputData.companyName}${inputData.url ? ` (website: ${inputData.url})` : ""}`;
    const result = await agent.generate(prompt);
    return { text: result.text };
  },
});

// Step 2: Data cleaning — structure raw data into CompanyProfile
const cleanDataStep = createStep({
  id: "clean-data",
  inputSchema: z.object({
    text: z.string(),
  }),
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "cleaning" });

    const agent = mastra.getAgent("dataEngineerAgent");
    const result = await agent.generate(
      `Clean and structure this raw company data into a CompanyProfile JSON:\n\n${inputData.text}`
    );
    return { text: result.text };
  },
});

// Step 3a: Financial analysis (runs in parallel with brand analysis)
const financialAnalysisStep = createStep({
  id: "financial-analysis",
  inputSchema: z.object({
    text: z.string(),
  }),
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "analyzing" });

    const agent = mastra.getAgent("financialAnalystAgent");
    const result = await agent.generate(
      `Analyze the financials of this company based on the following CompanyProfile:\n\n${inputData.text}`
    );
    return { text: result.text };
  },
});

// Step 3b: Brand & market analysis (runs in parallel with financial analysis)
const brandAnalysisStep = createStep({
  id: "brand-analysis",
  inputSchema: z.object({
    text: z.string(),
  }),
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "analyzing" });

    const agent = mastra.getAgent("brandMarketAgent");
    const result = await agent.generate(
      `Analyze the brand and market position of this company based on the following CompanyProfile:\n\n${inputData.text}`
    );
    return { text: result.text };
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
  }),
  execute: async ({ inputData, mastra, getStepResult, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "validating" });

    const agent = mastra.getAgent("qaValidatorAgent");
    const companyProfile = getStepResult<{ text: string }>("clean-data").text;
    const financial = inputData["financial-analysis"].text;
    const brand = inputData["brand-analysis"].text;

    const result = await agent.generate(
      `Validate this analysis package:

      Company Profile:
      ${companyProfile}

      Financial Analysis:
      ${financial}

      Brand & Market Analysis:
      ${brand}`
    );

    return {
      text: result.text,
      companyProfile,
      financialAnalysis: financial,
      brandAnalysis: brand,
    };
  },
});

// Step 4b: Conditional retry — re-run pipeline if QA detects critical gaps (max 1 retry)
const conditionalRetryStep = createStep({
  id: "conditional-retry",
  inputSchema: z.object({
    text: z.string(),
    companyProfile: z.string(),
    financialAnalysis: z.string(),
    brandAnalysis: z.string(),
  }),
  outputSchema: z.object({
    text: z.string(),
    companyProfile: z.string(),
    financialAnalysis: z.string(),
    brandAnalysis: z.string(),
  }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId, companyName, url } = getInitData<WorkflowInput>();

    // Try to parse QA result to check requiresRerun
    let qaResult: { requiresRerun?: boolean; rerunInstructions?: string | null } = {};
    try {
      qaResult = JSON.parse(inputData.text);
    } catch {
      // If QA output isn't valid JSON, skip retry
      return inputData;
    }

    if (!qaResult.requiresRerun || !qaResult.rerunInstructions) {
      return inputData;
    }

    // --- Retry cycle ---
    updateAnalysis(analysisId, { status: "ingesting", retryCount: 1 });

    // Re-run ingestion with targeted instructions
    const ingestionAgent = mastra.getAgent("ingestionAgent");
    const ingestionResult = await ingestionAgent.generate(
      `You are re-running research on ${companyName}${url ? ` (${url})` : ""} to fill critical data gaps.

Previous analysis had these gaps that need to be addressed:
${qaResult.rerunInstructions}

Focus your searches specifically on filling these gaps. Return your findings as a JSON object with the same structure as before (companyName, inputUrl, officialWebsite, rawSources array).

Return ONLY the JSON object, no additional text.`
    );

    // Re-run data engineer
    updateAnalysis(analysisId, { status: "cleaning", retryCount: 1 });
    const dataEngineerAgent = mastra.getAgent("dataEngineerAgent");
    const cleanedResult = await dataEngineerAgent.generate(
      `Clean and structure this raw company data into a CompanyProfile JSON. This is a retry run — merge with and improve upon the previous profile where possible.

Previous CompanyProfile:
${inputData.companyProfile}

New raw data:
${ingestionResult.text}`
    );

    // Re-run parallel analysis
    updateAnalysis(analysisId, { status: "analyzing", retryCount: 1 });
    const financialAgent = mastra.getAgent("financialAnalystAgent");
    const brandAgent = mastra.getAgent("brandMarketAgent");

    const [financialResult, brandResult] = await Promise.all([
      financialAgent.generate(
        `Analyze the financials of this company based on the following CompanyProfile:\n\n${cleanedResult.text}`
      ),
      brandAgent.generate(
        `Analyze the brand and market position of this company based on the following CompanyProfile:\n\n${cleanedResult.text}`
      ),
    ]);

    // Re-run QA validation
    updateAnalysis(analysisId, { status: "validating", retryCount: 1 });
    const qaAgent = mastra.getAgent("qaValidatorAgent");
    const qaRevalidation = await qaAgent.generate(
      `Validate this analysis package (this is a RETRY — be lenient on gaps that were already flagged):

      Company Profile:
      ${cleanedResult.text}

      Financial Analysis:
      ${financialResult.text}

      Brand & Market Analysis:
      ${brandResult.text}`
    );

    return {
      text: qaRevalidation.text,
      companyProfile: cleanedResult.text,
      financialAnalysis: financialResult.text,
      brandAnalysis: brandResult.text,
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
  outputSchema: z.object({
    text: z.string(),
  }),
  execute: async ({ inputData, mastra, getInitData }) => {
    const { analysisId } = getInitData<WorkflowInput>();
    updateAnalysis(analysisId, { status: "generating_report" });

    const agent = mastra.getAgent("reportAgent");
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
    return { text: result.text };
  },
});

// Assemble the workflow
export const pythiaWorkflow = createWorkflow({
  id: "pythia-analysis",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    text: z.string(),
  }),
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

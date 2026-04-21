// Shared implementation of the clean → analyze → validate slice of the
// Pythia pipeline.
//
// Both the main workflow's steps and the retry branch need to run the same
// agent passes with the same prompts, same schemas, and the same
// "persist parsed object to state" side effects. Before extraction they
// lived in two places and drifted — a prompt tweak had to land twice, and
// the retry branch had subtly different persistence behaviour than the
// initial run.
//
// The helpers are deliberately pure-ish: they take a Mastra instance +
// analysis id, do the LLM work, persist via `updateAnalysis`, and return
// the parsed object plus its re-serialised JSON text. Orchestration
// (status transitions, step-duration recording, retry control flow) stays
// in the workflow step that calls them.
//
// The "primitives" (`runCleanData`, `runFinancial`, `runBrand`,
// `runValidation`) are used individually by the main DAG — Mastra's
// `.parallel()` needs distinct step ids, so financial and brand run as
// separate workflow steps. The retry branch uses
// `runParallelAnalysis` which just composes the two primitives via
// `Promise.all`, so we have a single "run financial + brand concurrently"
// call site without splitting into workflow steps.

import type { Mastra } from "@mastra/core";
import { updateAnalysis } from "@/lib/store";
import type {
  BrandMarketAnalysis,
  CompanyProfile,
  FinancialAnalysis,
  QAValidation,
} from "@/lib/types";
import { generateStructured } from "./structured-generate";
import { getAgent } from "./agents";
import {
  brandMarketAnalysisSchema,
  companyProfileSchema,
  financialAnalysisSchema,
  qaValidationSchema,
} from "../schemas";

// ---------- data engineer ----------

export interface CleanedProfile {
  object: CompanyProfile;
  text: string;
}

/**
 * Run the data engineer over a raw-ingestion JSON blob (or a prior profile
 * + new raw data, for the retry case). Persists the parsed CompanyProfile
 * onto the analysis state.
 */
export async function runCleanData(
  mastra: Mastra,
  analysisId: string,
  rawIngestionJson: string,
  priorProfileJson?: string
): Promise<CleanedProfile> {
  const agent = getAgent(mastra, "dataEngineer");
  const prompt = priorProfileJson
    ? `Clean and structure this raw company data into a CompanyProfile JSON. This is a retry run — merge with and improve upon the previous profile where possible.

Previous CompanyProfile:
${priorProfileJson}

New raw data:
${rawIngestionJson}`
    : `Clean and structure this raw company data into a CompanyProfile JSON:\n\n${rawIngestionJson}`;

  const { object, text } = await generateStructured(
    agent,
    prompt,
    companyProfileSchema
  );
  updateAnalysis(analysisId, { companyProfile: object as CompanyProfile });
  return { object: object as CompanyProfile, text };
}

// ---------- financial ----------

export interface FinancialResult {
  object: FinancialAnalysis;
  text: string;
}

export async function runFinancial(
  mastra: Mastra,
  analysisId: string,
  profileJson: string
): Promise<FinancialResult> {
  const agent = getAgent(mastra, "financialAnalyst");
  const { object, text } = await generateStructured(
    agent,
    `Analyze the financials of this company based on the following CompanyProfile:\n\n${profileJson}`,
    financialAnalysisSchema
  );
  updateAnalysis(analysisId, {
    financialAnalysis: object as FinancialAnalysis,
  });
  return { object: object as FinancialAnalysis, text };
}

// ---------- brand / market ----------

export interface BrandResult {
  object: BrandMarketAnalysis;
  text: string;
}

export async function runBrand(
  mastra: Mastra,
  analysisId: string,
  profileJson: string
): Promise<BrandResult> {
  const agent = getAgent(mastra, "brandMarket");
  const { object, text } = await generateStructured(
    agent,
    `Analyze the brand and market position of this company based on the following CompanyProfile:\n\n${profileJson}`,
    brandMarketAnalysisSchema
  );
  updateAnalysis(analysisId, {
    brandMarketAnalysis: object as BrandMarketAnalysis,
  });
  return { object: object as BrandMarketAnalysis, text };
}

/**
 * Thin composition of `runFinancial` + `runBrand` for call sites (i.e. the
 * retry branch) that want both at once without splitting into separate
 * Mastra workflow steps.
 */
export async function runParallelAnalysis(
  mastra: Mastra,
  analysisId: string,
  profileJson: string
): Promise<{ financial: FinancialResult; brand: BrandResult }> {
  const [financial, brand] = await Promise.all([
    runFinancial(mastra, analysisId, profileJson),
    runBrand(mastra, analysisId, profileJson),
  ]);
  return { financial, brand };
}

// ---------- QA validator ----------

export interface ValidationResult {
  object: QAValidation;
  text: string;
}

/**
 * Run QA validation against the cleaned profile + financial + brand outputs.
 * The `isRetry` flag tweaks the prompt to make the validator lenient on
 * gaps it already flagged in the first pass — otherwise it tends to
 * re-flag the same gaps and trigger an infinite retry loop.
 */
export async function runValidation(
  mastra: Mastra,
  analysisId: string,
  inputs: { profile: string; financial: string; brand: string },
  isRetry = false
): Promise<ValidationResult> {
  const agent = getAgent(mastra, "qaValidator");
  const preamble = isRetry
    ? "Validate this analysis package (this is a RETRY — be lenient on gaps that were already flagged):"
    : "Validate this analysis package:";

  const { object, text } = await generateStructured(
    agent,
    `${preamble}

      Company Profile:
      ${inputs.profile}

      Financial Analysis:
      ${inputs.financial}

      Brand & Market Analysis:
      ${inputs.brand}`,
    qaValidationSchema
  );

  updateAnalysis(analysisId, { qaValidation: object as QAValidation });
  return { object: object as QAValidation, text };
}

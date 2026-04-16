import type { PythiaAnalysisState } from "./types";

const analyses = new Map<string, PythiaAnalysisState>();

export function createAnalysis(
  id: string,
  companyName: string,
  url?: string
): PythiaAnalysisState {
  const state: PythiaAnalysisState = {
    input: { companyName, url },
    ingestion: null,
    companyProfile: null,
    financialAnalysis: null,
    brandMarketAnalysis: null,
    qaValidation: null,
    report: null,
    status: "idle",
    retryCount: 0,
    error: null,
    createdAt: new Date().toISOString(),
  };
  analyses.set(id, state);
  return state;
}

export function getAnalysis(id: string): PythiaAnalysisState | undefined {
  return analyses.get(id);
}

export function updateAnalysis(
  id: string,
  updates: Partial<PythiaAnalysisState>
): PythiaAnalysisState | undefined {
  const existing = analyses.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates };
  analyses.set(id, updated);
  return updated;
}

export function listAnalyses(): Array<{
  id: string;
  companyName: string;
  status: PythiaAnalysisState["status"];
  createdAt: string;
}> {
  const result: Array<{
    id: string;
    companyName: string;
    status: PythiaAnalysisState["status"];
    createdAt: string;
  }> = [];

  for (const [id, state] of analyses) {
    result.push({
      id,
      companyName: state.input.companyName,
      status: state.status,
      createdAt: state.createdAt,
    });
  }

  // Most recent first
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return result;
}

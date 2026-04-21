import { getAnalysis } from "@/lib/store";
import type { PythiaAnalysisState } from "@/lib/types";

// Boilerplate helper for routes under `/api/analysis/[id]`. Every handler
// needs the same two lines — await the dynamic param, then 404 on missing —
// so collapse that into one. Returns either a `Response` (to be returned
// directly) or a resolved `{ id, analysis }` tuple for the success path.
//
// Callers use it like:
//     const got = await requireAnalysis(params);
//     if (got instanceof Response) return got;
//     const { id, analysis } = got;
//
// The `instanceof Response` guard is what keeps TS happy without forcing a
// throwable error — routes that already stream their own bodies (SSE) need
// to own Response construction themselves.

type ParamsPromise = Promise<{ id: string }>;

export async function requireAnalysis(
  params: ParamsPromise
): Promise<Response | { id: string; analysis: PythiaAnalysisState }> {
  const { id } = await params;
  const analysis = getAnalysis(id);
  if (!analysis) {
    return Response.json({ error: "Analysis not found" }, { status: 404 });
  }
  return { id, analysis };
}

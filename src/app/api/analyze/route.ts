import { mastra } from "@/mastra";
import { createAnalysis, updateAnalysis } from "@/lib/store";

export async function POST(request: Request) {
  const body = await request.json();
  const { companyName, url } = body;

  if (!companyName || typeof companyName !== "string") {
    return Response.json(
      { error: "companyName is required" },
      { status: 400 }
    );
  }

  const id = crypto.randomUUID();
  createAnalysis(id, companyName, url);

  // Run workflow in background (fire-and-forget)
  // Status updates happen inside each workflow step via updateAnalysis()
  const workflow = mastra.getWorkflow("pythiaWorkflow");
  workflow.createRun().then(async (run) => {
    try {
      const result = await run.start({
        inputData: { companyName, url, analysisId: id },
      });

      if (result.status === "success") {
        updateAnalysis(id, {
          status: "complete",
          report: result.result.text,
        });
      } else {
        updateAnalysis(id, {
          status: "error",
          error: result.status === "failed" ? result.error.message : result.status,
        });
      }
    } catch (err) {
      updateAnalysis(id, {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  return Response.json({ id, companyName });
}

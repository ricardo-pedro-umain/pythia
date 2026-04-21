import { mastra } from "@/mastra";
import { createAnalysis, updateAnalysis } from "@/lib/store";

// Hard cap on a workflow run. At ~5 LLM calls on gpt-4o plus Tavily searches,
// the p99 happy path is well under 5 minutes; one retry cycle can push into
// the 8-10 minute range. 15 minutes gives a comfortable margin without
// leaving a stuck run "in progress" forever if an upstream API hangs.
const WORKFLOW_TIMEOUT_MS = 15 * 60 * 1000;

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

  // Create the run up front so any startup failure (bad workflow config,
  // etc.) surfaces here as a 500 — before we return an id the client would
  // otherwise hold onto forever while watching an empty stream.
  const workflow = mastra.getWorkflow("pythiaWorkflow");
  let run: Awaited<ReturnType<typeof workflow.createRun>>;
  try {
    run = await workflow.createRun();
  } catch (err) {
    updateAnalysis(id, {
      status: "error",
      error:
        err instanceof Error
          ? `Failed to start workflow: ${err.message}`
          : "Failed to start workflow",
    });
    return Response.json(
      { error: "Failed to start analysis" },
      { status: 500 }
    );
  }

  // Kick off the workflow without awaiting; step-level updateAnalysis calls
  // stream progress to the client via SSE. We wrap in Promise.race so a
  // stuck upstream dependency can't leave the row in limbo.
  (async () => {
    try {
      const result = await Promise.race([
        run.start({ inputData: { companyName, url, analysisId: id } }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Workflow exceeded ${WORKFLOW_TIMEOUT_MS / 60000}-minute timeout`
                )
              ),
            WORKFLOW_TIMEOUT_MS
          )
        ),
      ]);

      if (result.status === "success") {
        updateAnalysis(id, {
          status: "complete",
          report: result.result.text,
        });
      } else {
        updateAnalysis(id, {
          status: "error",
          error:
            result.status === "failed" ? result.error.message : result.status,
        });
      }
    } catch (err) {
      updateAnalysis(id, {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  })();

  return Response.json({ id, companyName });
}

import { mastra } from "@/mastra";
import { getAnalysis } from "@/lib/store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const analysis = getAnalysis(id);

  if (!analysis) {
    return Response.json({ error: "Analysis not found" }, { status: 404 });
  }

  if (analysis.status !== "complete" || !analysis.report) {
    return Response.json(
      { error: "Analysis is not yet complete" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { message } = body;

  if (!message || typeof message !== "string") {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const agent = mastra.getAgent("chatAgent");
  const result = await agent.generate(
    `Here is the full intelligence report and analysis data for context:

${analysis.report}

---

User question: ${message}`
  );

  return Response.json({ response: result.text });
}

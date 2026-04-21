import { mastra } from "@/mastra";
import { updateAnalysis } from "@/lib/store";
import { requireAnalysis } from "../_helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const got = await requireAnalysis(params);
  if (got instanceof Response) return got;
  const { id, analysis } = got;

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

  const history = analysis.chatMessages ?? [];

  // Build a single prompt that includes the report context plus the full
  // conversation history, so the agent can reference earlier turns.
  const historyText = history
    .map((m) => `${m.role === "user" ? "User" : "Pythia"}: ${m.content}`)
    .join("\n\n");

  const agent = mastra.getAgent("chatAgent");
  const result = await agent.generate(
    `Here is the full intelligence report and analysis data for context:

${analysis.report}

---

${historyText ? `Previous conversation:\n\n${historyText}\n\n---\n\n` : ""}User question: ${message}`
  );

  // Use the updater form so two rapid user messages can't race and drop
  // one another's turn. The read-append happens inside the SQLite txn.
  const assistantMsg = { role: "assistant" as const, content: result.text };
  const userMsg = { role: "user" as const, content: message };
  const updated = updateAnalysis(id, (prev) => ({
    chatMessages: [...(prev.chatMessages ?? []), userMsg, assistantMsg],
  }));

  return Response.json({
    response: result.text,
    messages: updated?.chatMessages ?? [],
  });
}

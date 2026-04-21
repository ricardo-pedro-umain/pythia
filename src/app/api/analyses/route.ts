import { listAnalyses, clearAllAnalyses } from "@/lib/store";

export async function GET() {
  return Response.json(listAnalyses());
}

export async function DELETE() {
  clearAllAnalyses();
  return Response.json({ ok: true });
}

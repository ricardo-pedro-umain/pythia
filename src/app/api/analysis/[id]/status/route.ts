import { getAnalysis } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const analysis = getAnalysis(id);

  if (!analysis) {
    return Response.json({ error: "Analysis not found" }, { status: 404 });
  }

  return Response.json(analysis);
}

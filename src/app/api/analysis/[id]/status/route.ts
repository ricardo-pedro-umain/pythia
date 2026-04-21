import { deleteAnalysis } from "@/lib/store";
import { requireAnalysis } from "../_helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const got = await requireAnalysis(params);
  if (got instanceof Response) return got;
  return Response.json(got.analysis);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteAnalysis(id);
  return Response.json({ ok: true });
}

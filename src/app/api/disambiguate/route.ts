import { disambiguateCompany } from "@/lib/disambiguate";

// Thin HTTP wrapper around `disambiguateCompany`. All of the heuristics and
// Tavily orchestration live in `@/lib/disambiguate` so they can be exercised
// without spinning up a route.

// Re-export for clients that still import the type from this module.
export type { CompanyCandidate } from "@/lib/disambiguate";

export async function POST(request: Request) {
  const body = await request.json();
  const companyName: string = body.companyName?.trim() ?? "";

  if (!companyName) return Response.json({ candidates: [] });

  try {
    const candidates = await disambiguateCompany(companyName);
    return Response.json({ candidates });
  } catch (err) {
    console.error("Disambiguation search failed:", err);
    return Response.json({ candidates: [] });
  }
}

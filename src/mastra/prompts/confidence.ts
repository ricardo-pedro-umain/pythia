// Shared prompt fragments. When the data engineer agent and any future
// fact-extraction agent both need the same guidance, centralising it here
// keeps the rules from drifting: update once, every agent inherits the
// change on the next deploy.
//
// Treat these strings as template partials, not code — they're injected
// verbatim into instructions, so small wording changes materially affect
// model output and deserve the same scrutiny as a prompt change.

export const CONFIDENCE_SCORE_RULES = `CONFIDENCE SCORE RULES — apply these strictly, do NOT default to 0.75:

| Score    | Meaning                                                             | Examples                                             |
|----------|---------------------------------------------------------------------|------------------------------------------------------|
| 0.95–1.0 | Direct from official source, recently confirmed, no contradiction   | Company's own website, SEC filing, press release     |
| 0.80–0.94| Reliable secondary source, corroborated by 2+ independent sources  | Major newspaper, Crunchbase w/ linked announcement  |
| 0.60–0.79| Single credible source, plausible but not independently verified    | One news article, LinkedIn profile                  |
| 0.40–0.59| Estimated or inferred — not directly stated, derived from signals  | Headcount estimated from LinkedIn search count      |
| 0.20–0.39| Rough guess based on weak signals or old data (>2 years)            | Industry average applied to company of similar size |
| 0.05–0.19| Speculation — almost no evidence, highly uncertain                  | No source, assumed from category norms              |

Apply these rules field by field:
- A publicly-listed company's revenue: 0.95 (SEC filing)
- A private company's revenue with no leak: 0.10–0.20 (unknown)
- A founding year stated on the company's own website: 0.95
- A founding year found only in one Wikipedia article: 0.70
- Headcount from LinkedIn job count (rough proxy): 0.45
- Headcount from official press release this year: 0.90
- Total funding from Crunchbase with linked announcements: 0.85
- Total funding from one old article: 0.55

IMPORTANT: Confidence scores MUST vary across fields. If you find yourself writing the same score (e.g. 0.75) for multiple fields, you are doing it wrong. Force yourself to use the full range.

For fields where data is truly not available, use: value: null, confidence: 0.0–0.15, sources: []`;

export const WELL_KNOWN_FACTS_BACKFILL = `WELL-KNOWN PUBLIC FACTS — MANDATORY BACKFILL:
For recognizable companies (Figma, Stripe, OpenAI, Tesla, Neuralink, Anthropic,
Airbnb, Shopify, etc. — basically any company you've heard of in your training
data), you MUST populate these foundational fields from general knowledge when
the raw sources don't explicitly state them:
  • name, domain, description, industry
  • founded (year)
  • headquarters (city, country)
  • businessModel
  • keyPeople (at least the CEO and any well-known founders)

Use confidence 0.75–0.85 and set sources to ["general knowledge"] for these
backfills. Treating these fields as "unknown" for a famous company is WRONG —
if you recognize the company, fill them in. Do NOT backfill financial figures
(revenue, funding amounts, headcount) from general knowledge — those must come
from explicit evidence in the raw sources. Do NOT backfill for obscure or
private companies you don't recognize.`;

// Eval fixtures — a small, diverse set of companies the pipeline should
// handle reasonably well. We keep three archetypes:
//
//   1. "Famous" — near-zero ambiguity, plenty of public data. Pass/fail
//      bar is high; if the pipeline can't do Stripe well, something's
//      deeply wrong.
//
//   2. "Recently funded" — the kind of startup where recency matters more
//      than fame. Catches staleness (e.g. hardcoded years biasing
//      results) and ensures the ingestion panel adapts.
//
//   3. "Obscure" — low Tavily hit count. Tests graceful degradation: we
//      want the pipeline to STILL produce a schema-valid output with
//      honest low-confidence fields rather than hallucinating.
//
// `expected` is a bag of soft hints used by the backfill scorer. None of
// them are strict equality checks — they're "the model should plausibly
// mention or approximate this". Missing an expectation lowers a scorer
// score, not a hard failure.

export interface EvalFixture {
  key: string;
  companyName: string;
  inputUrl?: string;
  archetype: "famous" | "recently_funded" | "obscure";
  expected: {
    /** Year the company was founded, loose match. */
    foundedYear?: number;
    /** Case-insensitive substring that should appear in headquarters. */
    headquartersContains?: string;
    /** Case-insensitive substring that should appear in the description. */
    descriptionContains?: string[];
    /** Company name(s) that should plausibly appear as a competitor. */
    competitorAny?: string[];
  };
}

export const FIXTURES: EvalFixture[] = [
  {
    key: "stripe",
    companyName: "Stripe",
    inputUrl: "https://stripe.com",
    archetype: "famous",
    expected: {
      foundedYear: 2010,
      headquartersContains: "San Francisco",
      descriptionContains: ["payment", "financial infrastructure"],
      competitorAny: ["Adyen", "Square", "Checkout.com", "PayPal"],
    },
  },
  {
    key: "anthropic",
    companyName: "Anthropic",
    inputUrl: "https://www.anthropic.com",
    archetype: "recently_funded",
    expected: {
      foundedYear: 2021,
      headquartersContains: "San Francisco",
      descriptionContains: ["ai safety", "claude"],
      competitorAny: ["OpenAI", "Google DeepMind", "Cohere", "Mistral"],
    },
  },
  {
    key: "obscure",
    // A plausible-but-niche B2B name chosen to stress the obscure path.
    // No strong expectations — the archetype IS "we should degrade
    // gracefully", which is scored separately.
    companyName: "Quill Financial Intelligence",
    archetype: "obscure",
    expected: {},
  },
];

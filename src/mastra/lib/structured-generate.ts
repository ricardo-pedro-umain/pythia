import type { Agent } from "@mastra/core/agent";
import type { ZodType, z } from "zod";

// Run an agent with `structuredOutput` and return the parsed object plus the
// raw text (the report generator downstream still consumes the stringified
// JSON, so we preserve both).
//
// Mastra's structured-output mode already retries & repairs JSON, but models
// occasionally return a validly-shaped `.object` with an empty `.text`, or
// vice versa. We normalise that: prefer `.object`, fall back to parsing
// `.text` with the same schema, and throw a descriptive error if neither
// yields a valid object. Callers get a single thing to await and a single
// failure mode.

export interface StructuredResult<T> {
  object: T;
  text: string;
}

export async function generateStructured<S extends ZodType>(
  agent: Agent,
  prompt: string,
  schema: S
): Promise<StructuredResult<z.infer<S>>> {
  // Mastra's generic on structuredOutput is invariant in a way that makes
  // arbitrary Zod schemas hard to pass without a cast. The runtime contract
  // (Standard Schema) is satisfied by any z.ZodType, so the cast is safe.
  const result = await agent.generate(prompt, {
    structuredOutput: { schema: schema as never },
  });

  // Prefer the structured object if the SDK parsed it. Some provider paths
  // (e.g. when the model tool-calls and returns prose) leave `.object`
  // undefined — fall through to parsing `.text`.
  if (result.object) {
    const parsed = schema.safeParse(result.object);
    if (parsed.success) {
      return { object: parsed.data, text: JSON.stringify(parsed.data) };
    }
  }

  // Last-resort: strip code fences and try to parse the raw text.
  const text = (result.text ?? "").trim();
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let jsonCandidate: unknown;
  try {
    jsonCandidate = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `Agent "${agent.name}" returned non-JSON output that could not be parsed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const parsed = schema.safeParse(jsonCandidate);
  if (!parsed.success) {
    throw new Error(
      `Agent "${agent.name}" output failed schema validation: ${parsed.error.message}`
    );
  }
  return { object: parsed.data, text: JSON.stringify(parsed.data) };
}

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { Agent } from "@mastra/core/agent";
import { generateStructured } from "./structured-generate";

// A minimal fake Agent that returns a caller-controlled `{ object?, text? }`.
// The real Agent surface is large; `generateStructured` only touches
// `.name`, `.generate(prompt, opts)`, so that's all we implement.
function makeFakeAgent(
  name: string,
  impl: () => Promise<{ object?: unknown; text?: string }>
): Agent {
  return {
    name,
    generate: vi.fn(impl),
  } as unknown as Agent;
}

const schema = z.object({
  foo: z.string(),
  n: z.number(),
});

describe("generateStructured", () => {
  it("prefers .object when the SDK parsed it successfully", async () => {
    const agent = makeFakeAgent("A", async () => ({
      object: { foo: "bar", n: 1 },
      // text intentionally wrong; should be ignored because .object parsed
      text: "garbage",
    }));

    const result = await generateStructured(agent, "prompt", schema);
    expect(result.object).toEqual({ foo: "bar", n: 1 });
    // `text` is re-serialised from the parsed object, not echoed from the
    // raw response — so "garbage" is gone.
    expect(JSON.parse(result.text)).toEqual({ foo: "bar", n: 1 });
  });

  it("falls back to parsing .text when .object is missing", async () => {
    const agent = makeFakeAgent("B", async () => ({
      text: JSON.stringify({ foo: "bar", n: 2 }),
    }));

    const result = await generateStructured(agent, "prompt", schema);
    expect(result.object).toEqual({ foo: "bar", n: 2 });
  });

  it("strips ```json code fences before parsing text", async () => {
    const agent = makeFakeAgent("C", async () => ({
      text: '```json\n{"foo":"bar","n":3}\n```',
    }));

    const result = await generateStructured(agent, "prompt", schema);
    expect(result.object).toEqual({ foo: "bar", n: 3 });
  });

  it("strips unlabeled ``` code fences as well", async () => {
    const agent = makeFakeAgent("D", async () => ({
      text: '```\n{"foo":"bar","n":4}\n```',
    }));

    const result = await generateStructured(agent, "prompt", schema);
    expect(result.object).toEqual({ foo: "bar", n: 4 });
  });

  it("falls back from a shape-invalid .object to .text if text parses", async () => {
    // .object is present but doesn't validate — the fallback path should
    // rescue this by parsing .text instead. This covers the class of bugs
    // where providers emit a malformed partial object but a valid JSON text.
    const agent = makeFakeAgent("E", async () => ({
      object: { foo: "bar" /* missing n */ },
      text: JSON.stringify({ foo: "bar", n: 5 }),
    }));

    const result = await generateStructured(agent, "prompt", schema);
    expect(result.object).toEqual({ foo: "bar", n: 5 });
  });

  it("throws a descriptive error when text is not JSON", async () => {
    const agent = makeFakeAgent("Bad1", async () => ({
      text: "this is not json at all",
    }));

    await expect(
      generateStructured(agent, "prompt", schema)
    ).rejects.toThrow(/Bad1.*non-JSON/i);
  });

  it("throws a descriptive error when text parses but schema rejects it", async () => {
    const agent = makeFakeAgent("Bad2", async () => ({
      text: JSON.stringify({ foo: 42, n: "nope" }),
    }));

    await expect(
      generateStructured(agent, "prompt", schema)
    ).rejects.toThrow(/Bad2.*schema validation/i);
  });

  it("throws when both .object and .text are missing/empty", async () => {
    const agent = makeFakeAgent("Empty", async () => ({}));
    await expect(
      generateStructured(agent, "prompt", schema)
    ).rejects.toThrow(/Empty.*non-JSON/i);
  });

  it("passes the prompt and schema through to agent.generate", async () => {
    const generate = vi.fn(async () => ({ object: { foo: "x", n: 0 } }));
    const agent = { name: "Probe", generate } as unknown as Agent;

    await generateStructured(agent, "hello world", schema);
    expect(generate).toHaveBeenCalledTimes(1);
    const [prompt, opts] = generate.mock.calls[0] as unknown as [
      string,
      { structuredOutput: { schema: unknown } },
    ];
    expect(prompt).toBe("hello world");
    expect(opts.structuredOutput.schema).toBe(schema);
  });
});

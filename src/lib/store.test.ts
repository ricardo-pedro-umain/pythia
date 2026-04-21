import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// store.ts derives its DB path from `process.cwd()/.data`. We rebind cwd to
// a fresh temp directory per test so the suite never touches the real
// `.data/` folder at the project root, and so the module-level singleton DB
// handle doesn't leak state between tests (we vi.resetModules() below).
let tempDir: string;
const realCwd = process.cwd.bind(process);

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pythia-store-test-"));
  process.cwd = () => tempDir;
  // Clear the module cache so the store's global-singleton DB handle is
  // recreated against the fresh temp directory.
  vi.resetModules();
});

afterEach(() => {
  // Close any lingering DB handle on the globalThis so fs.rmSync succeeds on
  // Windows / WAL-mode Linux where the file can still be locked.
  const g = globalThis as unknown as { __pythia_db?: { close: () => void } };
  g.__pythia_db?.close();
  g.__pythia_db = undefined;

  process.cwd = realCwd;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function loadStore() {
  // Dynamic import ensures the module initializes against the current cwd.
  return await import("./store");
}

describe("createAnalysis / getAnalysis", () => {
  it("creates a row and returns the freshly-initialized state", async () => {
    const { createAnalysis, getAnalysis } = await loadStore();
    const state = createAnalysis("abc", "Stripe", "https://stripe.com");

    expect(state.input).toEqual({
      companyName: "Stripe",
      url: "https://stripe.com",
    });
    expect(state.status).toBe("idle");
    expect(state.retryCount).toBe(0);
    expect(state.ingestion).toBeNull();
    expect(state.chatMessages).toEqual([]);
    expect(state.stepDurations).toEqual({});
    expect(state.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const fetched = getAnalysis("abc");
    expect(fetched).toEqual(state);
  });

  it("getAnalysis returns undefined for unknown ids", async () => {
    const { getAnalysis } = await loadStore();
    expect(getAnalysis("nope")).toBeUndefined();
  });
});

describe("updateAnalysis - partial form", () => {
  it("shallow-merges the patch onto existing state", async () => {
    const { createAnalysis, updateAnalysis, getAnalysis } = await loadStore();
    createAnalysis("id1", "Acme");

    const updated = updateAnalysis("id1", {
      status: "ingesting",
      retryCount: 1,
    });

    expect(updated?.status).toBe("ingesting");
    expect(updated?.retryCount).toBe(1);
    expect(updated?.input.companyName).toBe("Acme"); // preserved

    // Persisted
    expect(getAnalysis("id1")?.status).toBe("ingesting");
  });

  it("returns undefined when the id doesn't exist", async () => {
    const { updateAnalysis } = await loadStore();
    expect(updateAnalysis("ghost", { status: "complete" })).toBeUndefined();
  });
});

describe("updateAnalysis - updater function form", () => {
  it("passes the freshly-read state and applies the returned patch", async () => {
    const { createAnalysis, updateAnalysis } = await loadStore();
    createAnalysis("id2", "Acme");

    const updated = updateAnalysis("id2", (prev) => ({
      stepDurations: {
        ...(prev.stepDurations ?? {}),
        ingesting: 250,
      },
    }));

    expect(updated?.stepDurations.ingesting).toBe(250);
  });

  it("serializes concurrent updater calls — no lost writes on nested fields", async () => {
    // This is the exact race the updater-function overload was introduced to
    // fix. Two parallel workflow steps (financial + brand) call
    // recordStepDuration at once; with a plain partial patch, whichever
    // committed second would clobber the other's stepDurations entry.
    //
    // better-sqlite3 transactions are synchronous, so we can fire many
    // updater-function calls back-to-back and every patch must see the
    // merged result of the prior write.
    const { createAnalysis, updateAnalysis, getAnalysis } = await loadStore();
    createAnalysis("id3", "Acme");

    const steps = [
      "ingesting",
      "cleaning",
      "analyzing",
      "validating",
      "generating_report",
    ] as const;

    // Interleave writes: each call merges against whatever was there before.
    for (const step of steps) {
      updateAnalysis("id3", (prev) => ({
        stepDurations: {
          ...(prev.stepDurations ?? {}),
          [step]: 100,
        },
      }));
    }

    const final = getAnalysis("id3");
    for (const step of steps) {
      expect(final?.stepDurations[step]).toBe(100);
    }
  });

  it("Promise.all of updater calls still results in all writes applied", async () => {
    // better-sqlite3 is synchronous, so Promise.all really just awaits
    // microtasks around synchronous work — but this still proves the
    // user-facing contract: fire N updates concurrently, see all N land.
    const { createAnalysis, updateAnalysis, getAnalysis } = await loadStore();
    createAnalysis("id4", "Acme");

    await Promise.all(
      Array.from({ length: 10 }).map((_, i) =>
        Promise.resolve().then(() =>
          updateAnalysis("id4", (prev) => ({
            chatMessages: [
              ...(prev.chatMessages ?? []),
              { role: "user" as const, content: `msg-${i}` },
            ],
          }))
        )
      )
    );

    const msgs = getAnalysis("id4")?.chatMessages ?? [];
    expect(msgs).toHaveLength(10);
    // Ordering isn't guaranteed under concurrent dispatch, but content set is.
    const contents = new Set(msgs.map((m) => m.content));
    for (let i = 0; i < 10; i++) {
      expect(contents.has(`msg-${i}`)).toBe(true);
    }
  });
});

describe("listAnalyses", () => {
  it("returns all rows ordered by createdAt desc", async () => {
    const { createAnalysis, listAnalyses, updateAnalysis } = await loadStore();
    createAnalysis("a", "Alpha");
    // Force distinct createdAt values so the ORDER BY has something to order on.
    updateAnalysis("a", () => ({ createdAt: "2024-01-01T00:00:00.000Z" }));
    createAnalysis("b", "Beta");
    updateAnalysis("b", () => ({ createdAt: "2025-01-01T00:00:00.000Z" }));

    const list = listAnalyses();
    expect(list).toHaveLength(2);
    // Newest first
    expect(list[0].id).toBe("b");
    expect(list[1].id).toBe("a");
  });

  it("returns [] when nothing has been created", async () => {
    const { listAnalyses } = await loadStore();
    expect(listAnalyses()).toEqual([]);
  });
});

describe("deleteAnalysis / clearAllAnalyses", () => {
  it("deleteAnalysis removes a single row", async () => {
    const { createAnalysis, deleteAnalysis, getAnalysis } = await loadStore();
    createAnalysis("x", "X");
    deleteAnalysis("x");
    expect(getAnalysis("x")).toBeUndefined();
  });

  it("clearAllAnalyses empties the table", async () => {
    const { createAnalysis, clearAllAnalyses, listAnalyses } =
      await loadStore();
    createAnalysis("x", "X");
    createAnalysis("y", "Y");
    clearAllAnalyses();
    expect(listAnalyses()).toEqual([]);
  });
});

describe("subscribeAnalysis", () => {
  it("fires the listener with the new state after every update", async () => {
    const { createAnalysis, updateAnalysis, subscribeAnalysis } =
      await loadStore();
    createAnalysis("sub1", "Sub");

    const events: string[] = [];
    const unsub = subscribeAnalysis("sub1", (s) => {
      events.push(s.status);
    });

    updateAnalysis("sub1", { status: "ingesting" });
    updateAnalysis("sub1", { status: "cleaning" });
    updateAnalysis("sub1", { status: "complete" });

    expect(events).toEqual(["ingesting", "cleaning", "complete"]);
    unsub();
  });

  it("unsubscribe prevents further listener calls", async () => {
    const { createAnalysis, updateAnalysis, subscribeAnalysis } =
      await loadStore();
    createAnalysis("sub2", "Sub");
    const listener = vi.fn();
    const unsub = subscribeAnalysis("sub2", listener);

    updateAnalysis("sub2", { status: "ingesting" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    updateAnalysis("sub2", { status: "cleaning" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not fire for unknown ids (updateAnalysis returns undefined)", async () => {
    const { updateAnalysis, subscribeAnalysis } = await loadStore();
    const listener = vi.fn();
    subscribeAnalysis("missing", listener);
    updateAnalysis("missing", { status: "ingesting" });
    expect(listener).not.toHaveBeenCalled();
  });
});

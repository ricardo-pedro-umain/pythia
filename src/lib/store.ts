import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import Database from "better-sqlite3";
import type { PythiaAnalysisState } from "./types";

// ---------------------------------------------------------------------------
// In-process pub/sub for live SSE updates. Keyed by analysis id — SSE
// handlers subscribe to `analysis:<id>`, store writers emit the new state
// after every successful commit. Module-level singleton so Next.js hot
// reloads don't orphan listeners.
// ---------------------------------------------------------------------------

declare global {
  var __pythia_events: EventEmitter | undefined;
}

function getEventBus(): EventEmitter {
  if (!globalThis.__pythia_events) {
    const bus = new EventEmitter();
    bus.setMaxListeners(0); // many concurrent SSE clients are fine
    globalThis.__pythia_events = bus;
  }
  return globalThis.__pythia_events;
}

export function subscribeAnalysis(
  id: string,
  listener: (state: PythiaAnalysisState) => void
): () => void {
  const bus = getEventBus();
  const channel = `analysis:${id}`;
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}

function emitAnalysis(id: string, state: PythiaAnalysisState): void {
  getEventBus().emit(`analysis:${id}`, state);
}

// ---------------------------------------------------------------------------
// SQLite — single-file DB with atomic per-row updates.
//
// Stored as a blob of JSON (the full PythiaAnalysisState) plus a few indexed
// columns so `listAnalyses()` doesn't have to parse every row. Updates run in
// a transaction that reads, merges, and writes back — eliminating the race
// the old JSON-file store had between parallel workflow steps.
// ---------------------------------------------------------------------------

// Persistent state lives in a dedicated `.data/` directory at the project
// root so the repo root stays tidy and all related SQLite files (-shm, -wal)
// sit together. Create on demand — simpler than a setup step.
const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "analyses.sqlite");

// better-sqlite3 is synchronous by design and safe to keep as a module-level
// singleton across Next.js hot reloads.
declare global {
  var __pythia_db: Database.Database | undefined;
}

function getDb(): Database.Database {
  if (!globalThis.__pythia_db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(DB_FILE);
    db.pragma("journal_mode = WAL"); // allow concurrent readers while writer commits
    db.pragma("synchronous = NORMAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id          TEXT PRIMARY KEY,
        companyName TEXT NOT NULL,
        status      TEXT NOT NULL,
        createdAt   TEXT NOT NULL,
        data        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS analyses_createdAt_idx ON analyses (createdAt DESC);
    `);
    globalThis.__pythia_db = db;
  }
  return globalThis.__pythia_db;
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

function statements() {
  const db = getDb();
  return {
    insert: db.prepare(
      `INSERT INTO analyses (id, companyName, status, createdAt, data)
       VALUES (@id, @companyName, @status, @createdAt, @data)`
    ),
    selectOne: db.prepare<[string], { data: string }>(
      `SELECT data FROM analyses WHERE id = ?`
    ),
    selectList: db.prepare<
      [],
      { id: string; companyName: string; status: string; createdAt: string }
    >(
      `SELECT id, companyName, status, createdAt
       FROM analyses ORDER BY createdAt DESC`
    ),
    update: db.prepare(
      `UPDATE analyses
       SET status = @status, data = @data
       WHERE id = @id`
    ),
    delete: db.prepare(`DELETE FROM analyses WHERE id = ?`),
    clear: db.prepare(`DELETE FROM analyses`),
  };
}

// ---------------------------------------------------------------------------
// Public API — identical surface to the previous JSON-file version
// ---------------------------------------------------------------------------

export function createAnalysis(
  id: string,
  companyName: string,
  url?: string
): PythiaAnalysisState {
  const state: PythiaAnalysisState = {
    input: { companyName, url },
    ingestion: null,
    companyProfile: null,
    financialAnalysis: null,
    brandMarketAnalysis: null,
    qaValidation: null,
    report: null,
    status: "idle",
    retryCount: 0,
    error: null,
    createdAt: new Date().toISOString(),
    chatMessages: [],
    stepDurations: {},
  };
  statements().insert.run({
    id,
    companyName,
    status: state.status,
    createdAt: state.createdAt,
    data: JSON.stringify(state),
  });
  return state;
}

export function getAnalysis(id: string): PythiaAnalysisState | undefined {
  const row = statements().selectOne.get(id);
  if (!row) return undefined;
  return JSON.parse(row.data) as PythiaAnalysisState;
}

/**
 * Read-modify-write inside a SQLite transaction. better-sqlite3 transactions
 * are synchronous and serialize automatically, so two concurrent
 * `updateAnalysis(id, …)` calls can't interleave their reads and writes.
 *
 * Two overloads:
 *
 *   updateAnalysis(id, { status: "complete" })
 *       — shallow merge the partial onto the existing state. Fine for
 *         top-level scalar fields.
 *
 *   updateAnalysis(id, prev => ({ stepDurations: {...prev.stepDurations, ...} }))
 *       — updater function executed *inside* the transaction, with the
 *         freshly-read state as its argument. Use this whenever the new
 *         value depends on a nested existing value (stepDurations,
 *         chatMessages, etc.) — a plain partial would clobber concurrent
 *         writes to the same nested object.
 */
type UpdateArg =
  | Partial<PythiaAnalysisState>
  | ((prev: PythiaAnalysisState) => Partial<PythiaAnalysisState>);

export function updateAnalysis(
  id: string,
  updates: UpdateArg
): PythiaAnalysisState | undefined {
  const db = getDb();
  const stmts = statements();

  const txn = db.transaction((): PythiaAnalysisState | undefined => {
    const row = stmts.selectOne.get(id);
    if (!row) return undefined;
    const existing = JSON.parse(row.data) as PythiaAnalysisState;
    const patch =
      typeof updates === "function" ? updates(existing) : updates;
    const updated: PythiaAnalysisState = { ...existing, ...patch };
    stmts.update.run({
      id,
      status: updated.status,
      data: JSON.stringify(updated),
    });
    return updated;
  });

  const updated = txn();
  if (updated) emitAnalysis(id, updated);
  return updated;
}

export function deleteAnalysis(id: string): void {
  statements().delete.run(id);
}

export function clearAllAnalyses(): void {
  statements().clear.run();
}

export function listAnalyses(): Array<{
  id: string;
  companyName: string;
  status: PythiaAnalysisState["status"];
  createdAt: string;
}> {
  return statements().selectList.all().map((r) => ({
    id: r.id,
    companyName: r.companyName,
    status: r.status as PythiaAnalysisState["status"],
    createdAt: r.createdAt,
  }));
}

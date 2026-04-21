"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PythiaAnalysisState } from "@/lib/types";

const AGENTS = [
  { key: "ingesting", label: "Ingestion Agent", description: "Gathering raw data from web sources" },
  { key: "cleaning", label: "Data Engineer", description: "Cleaning and structuring data" },
  { key: "analyzing", label: "Financial Analyst + Brand Agent", description: "Running parallel analysis" },
  { key: "validating", label: "QA Validator", description: "Cross-validating findings" },
  { key: "generating_report", label: "Report Agent", description: "Generating intelligence report" },
] as const;

type AgentKey = (typeof AGENTS)[number]["key"];

function StatusIcon({ state }: { state: "done" | "active" | "pending" | "error" }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
        &#10003;
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="absolute h-5 w-5 animate-ping rounded-full bg-accent/30" />
        <span className="relative h-3 w-3 rounded-full bg-accent" />
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-400 text-xs">
        &#10007;
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-border" />
    </span>
  );
}

function formatDuration(ms: number): string {
  // Sub-second → show as "123ms" so fast steps don't round to a misleading "0s".
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function ElapsedTimer({ startTime }: { startTime: number }) {
  // Lazy initializer — `Date.now()` is impure, so passing it directly
  // would trip react-hooks/purity and re-read the clock on every render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-xs font-mono text-accent/70">
      {formatDuration(now - startTime)}
    </span>
  );
}

const ORDER: AgentKey[] = AGENTS.map((a) => a.key);

function getAgentState(
  agentKey: AgentKey,
  status: PythiaAnalysisState["status"],
  retryCount: number
): "done" | "active" | "pending" | "error" {
  if (status === "complete") return "done";
  if (status === "idle") return "pending";
  if (status === "error") return "pending";

  const currentIdx = ORDER.indexOf(status as AgentKey);
  const agentIdx = ORDER.indexOf(agentKey);

  if (currentIdx === -1) return "pending";

  if (retryCount > 0) {
    if (agentIdx < currentIdx) return "done";
    if (agentIdx === currentIdx) return "active";
    return "pending";
  }

  if (agentIdx < currentIdx) return "done";
  if (agentIdx === currentIdx) return "active";
  return "pending";
}

export function AgentActivityFeed({
  status,
  retryCount = 0,
  stepDurations,
}: {
  status: PythiaAnalysisState["status"];
  retryCount?: number;
  stepDurations?: PythiaAnalysisState["stepDurations"];
}) {
  // Track when the currently-active step became active, so we can show a
  // live elapsed timer while it runs. The authoritative finished durations
  // come from the server via `stepDurations`.
  const activeStartRef = useRef<Record<string, number>>({});
  const prevStatusRef = useRef(status);

  useLayoutEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prevStatus !== status) {
      delete activeStartRef.current[prevStatus];
      const currentIdx = ORDER.indexOf(status as AgentKey);
      if (currentIdx !== -1 && !activeStartRef.current[status]) {
        activeStartRef.current[status] = Date.now();
      }
    }
  }, [status]);

  // Record start time for the initial active step (runs once on mount)
  useEffect(() => {
    const currentIdx = ORDER.indexOf(status as AgentKey);
    if (currentIdx !== -1 && !activeStartRef.current[status]) {
      activeStartRef.current[status] = Date.now();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
        Agent Pipeline
      </h2>

      {retryCount > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 animate-fade-in">
          <p className="text-xs text-yellow-400 font-medium">
            Retry #{retryCount} — filling data gaps
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5 stagger-children">
        {AGENTS.map((agent) => {
          const state = getAgentState(agent.key, status, retryCount);
          const completedDuration = stepDurations?.[agent.key];
          const activeStart = activeStartRef.current[agent.key];

          return (
            <div
              key={agent.key}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all duration-300 ${
                state === "active"
                  ? "border-accent/40 bg-accent/5 shadow-[0_0_15px_-3px_rgba(99,102,241,0.15)]"
                  : state === "done"
                    ? "border-border/40 bg-muted/20"
                    : "border-transparent bg-transparent"
              }`}
            >
              <StatusIcon state={state} />
              <div className="flex flex-1 flex-col min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-medium truncate ${
                      state === "active"
                        ? "text-foreground"
                        : state === "done"
                          ? "text-muted-foreground"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    {agent.label}
                  </span>
                  {state === "active" && activeStart && (
                    <ElapsedTimer startTime={activeStart} />
                  )}
                  {state === "done" && completedDuration != null && (
                    <span className="text-xs font-mono text-muted-foreground/50">
                      {formatDuration(completedDuration)}
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs truncate ${
                    state === "active"
                      ? "text-muted-foreground/70"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {agent.description}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

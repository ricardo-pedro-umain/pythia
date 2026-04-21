"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AnalysisSummary {
  id: string;
  companyName: string;
  status: string;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  complete: { dot: "bg-emerald-400", label: "Complete" },
  error: { dot: "bg-red-400", label: "Error" },
};

function getStatus(status: string) {
  return STATUS_STYLES[status] ?? { dot: "bg-accent animate-pulse", label: "In progress" };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AnalysesPage() {
  const router = useRouter();
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  useEffect(() => {
    fetch("/api/analyses")
      .then((r) => r.json())
      .then((data: AnalysisSummary[]) => { setAnalyses(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  async function handleDelete(id: string) {
    await fetch(`/api/analysis/${id}/status`, { method: "DELETE" });
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleClearAll() {
    if (!confirmClearAll) { setConfirmClearAll(true); return; }
    await fetch("/api/analyses", { method: "DELETE" });
    setAnalyses([]);
    setConfirmClearAll(false);
  }

  return (
    <div className="flex flex-1 flex-col p-6 sm:p-8 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
            Back
          </button>
          <span className="text-border text-sm">|</span>
          <Link href="/" className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity">
            Pythia
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground font-medium">All Companies</span>
        </div>

        {analyses.length > 0 && (
          <button
            onClick={handleClearAll}
            onBlur={() => setConfirmClearAll(false)}
            className={`text-xs transition-colors ${
              confirmClearAll
                ? "text-red-400 hover:text-red-300"
                : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
          >
            {confirmClearAll ? "Confirm clear all" : "Clear all"}
          </button>
        )}
      </div>

      {/* Content */}
      {!loaded ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : analyses.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center animate-fade-in">
          <p className="text-muted-foreground text-sm">No analyses yet.</p>
          <Link
            href="/"
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            Start your first analysis
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2 animate-fade-in">
          {analyses.map((a) => {
            const { dot, label } = getStatus(a.status);
            return (
              <div key={a.id} className="group/row relative">
                <Link
                  href={`/analysis/${a.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 hover:border-border hover:bg-muted/30 transition-colors group pr-10"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
                    <span className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">
                      {a.companyName}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground/50">{label}</span>
                    <span className="text-xs text-muted-foreground/40">{timeAgo(a.createdAt)}</span>
                  </div>
                </Link>
                {/* Per-row delete */}
                <button
                  onClick={() => handleDelete(a.id)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/30 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                    <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

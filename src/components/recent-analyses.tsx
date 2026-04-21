"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AnalysisSummary {
  id: string;
  companyName: string;
  status: string;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { dot: string }> = {
  complete: { dot: "bg-emerald-400" },
  error: { dot: "bg-red-400" },
};

function getStatusDot(status: string) {
  return (STATUS_STYLES[status] ?? { dot: "bg-accent animate-pulse" }).dot;
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

/** Deduplicate by company name, keeping the most recent per company. */
function dedupeByCompany(analyses: AnalysisSummary[], limit: number): AnalysisSummary[] {
  const seen = new Set<string>();
  const result: AnalysisSummary[] = [];
  for (const a of analyses) {
    const key = a.companyName.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(a);
    }
    if (result.length >= limit) break;
  }
  return result;
}

export function RecentAnalyses() {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/analyses")
      .then((r) => r.json())
      .then((data: AnalysisSummary[]) => { setAnalyses(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/analysis/${id}/status`, { method: "DELETE" });
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
  }

  if (!loaded || analyses.length === 0) return null;

  const companies = dedupeByCompany(analyses, 3);

  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
        Recent Analyses
      </h3>
      <div className="flex flex-col gap-1.5">
        {companies.map((a) => (
          <div key={a.id} className="group/row relative">
            <Link
              href={`/analysis/${a.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 hover:border-border hover:bg-muted/30 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`h-2 w-2 rounded-full shrink-0 ${getStatusDot(a.status)}`} />
                <span className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">
                  {a.companyName}
                </span>
              </div>
              <span className="text-xs text-muted-foreground/50 shrink-0 pr-6">
                {timeAgo(a.createdAt)}
              </span>
            </Link>
            {/* Delete button — appears on row hover */}
            <button
              onClick={(e) => handleDelete(e, a.id)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/30 hover:text-red-400 transition-colors"
              title="Remove"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-center">
        <Link
          href="/analyses"
          className="rounded-md border border-border/50 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          All Companies
        </Link>
      </div>
    </div>
  );
}

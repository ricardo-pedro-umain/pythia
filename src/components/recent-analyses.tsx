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

function AnalysisRow({ analysis }: { analysis: AnalysisSummary }) {
  return (
    <Link
      href={`/analysis/${analysis.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 hover:border-border hover:bg-muted/30 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={`h-2 w-2 rounded-full shrink-0 ${getStatusDot(analysis.status)}`} />
        <span className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">
          {analysis.companyName}
        </span>
      </div>
      <span className="text-xs text-muted-foreground/50 shrink-0">
        {timeAgo(analysis.createdAt)}
      </span>
    </Link>
  );
}

export function RecentAnalyses() {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/analyses")
      .then((res) => res.json())
      .then((data: AnalysisSummary[]) => {
        setAnalyses(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded || analyses.length === 0) return null;

  const recent = analyses.slice(0, 3);

  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
        Recent
      </h3>
      <div className="flex flex-col gap-1.5">
        {recent.map((a) => (
          <AnalysisRow key={a.id} analysis={a} />
        ))}
      </div>
    </div>
  );
}

export function SavedCompanies() {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/analyses")
      .then((res) => res.json())
      .then((data: AnalysisSummary[]) => {
        setAnalyses(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded || analyses.length === 0) return null;

  // Deduplicate by company name, keep most recent per company, up to 10
  const seen = new Set<string>();
  const companies: AnalysisSummary[] = [];
  for (const a of analyses) {
    const key = a.companyName.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      companies.push(a);
    }
    if (companies.length >= 10) break;
  }

  if (companies.length === 0) return null;

  return (
    <div>
      <h3 className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2">
        Companies
      </h3>
      <div className="flex flex-col">
        {companies.map((a) => (
          <Link
            key={a.id}
            href={`/analysis/${a.id}`}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] text-muted-foreground/70 hover:text-foreground transition-colors group"
          >
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${getStatusDot(a.status)}`} />
            <span className="truncate group-hover:text-accent transition-colors">
              {a.companyName}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

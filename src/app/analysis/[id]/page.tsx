"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import Link from "next/link";
import type { PythiaAnalysisState } from "@/lib/types";
import { AgentActivityFeed } from "@/components/agent-activity-feed";
import { ReportViewer } from "@/components/report-viewer";
import { ChatPanel, type ChatMessage } from "@/components/chat-panel";

const STATUS_LABELS: Record<PythiaAnalysisState["status"], string> = {
  idle: "Starting up",
  ingesting: "Gathering data",
  cleaning: "Structuring data",
  analyzing: "Running analysis",
  validating: "Validating findings",
  generating_report: "Writing report",
  complete: "Complete",
  error: "Error",
};

export default function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [analysis, setAnalysis] = useState<PythiaAnalysisState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleSendMessage = useCallback(async (message: string) => {
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatLoading(true);

    try {
      const res = await fetch(`/api/analysis/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) throw new Error("Failed to get response");

      const data = await res.json();
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I encountered an error. Please try again." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/analysis/${id}/status`);
        if (!res.ok) {
          setError("Analysis not found");
          return;
        }
        const data: PythiaAnalysisState = await res.json();
        if (active) {
          setAnalysis(data);
          if (data.status !== "complete" && data.status !== "error") {
            setTimeout(poll, 2000);
          }
        }
      } catch {
        if (active) setError("Failed to fetch analysis status");
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, [id]);

  const handleDownloadPdf = useCallback(async () => {
    if (!reportRef.current || downloading) return;
    setDownloading(true);

    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const { jsPDF } = await import("jspdf");

      // Report already has a light paper-like theme, capture directly
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#f0eeeb",
      });

      const imgWidth = 190;
      const pageHeight = 277;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pdf = new jsPDF("p", "mm", "a4");

      let heightLeft = imgHeight;
      let position = 10;

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 10, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight + 10;
        pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 10, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const companyName = analysis?.input.companyName?.replace(/\s+/g, "_") ?? "report";
      pdf.save(`Pythia_${companyName}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [analysis, downloading]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 animate-fade-in">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <span className="text-red-400 text-xl">!</span>
        </div>
        <p className="text-muted-foreground">{error}</p>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          Start a new analysis
        </Link>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading analysis...</p>
        </div>
      </div>
    );
  }

  const isComplete = analysis.status === "complete";

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity shrink-0">
            Pythia
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground font-medium truncate">
            {analysis.input.companyName}
          </span>
          <Link
            href="/"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shrink-0"
          >
            New Search
          </Link>
          <Link
            href="/"
            className="rounded-md bg-accent/10 border border-accent/20 px-2.5 py-1 text-xs text-accent hover:bg-accent/20 transition-colors shrink-0"
          >
            All Companies
          </Link>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isComplete && (
            <button
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:bg-accent/90 disabled:opacity-50 hidden sm:inline-flex"
            >
              {downloading ? (
                <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M2.75 14a.75.75 0 0 1 0-1.5h10.5a.75.75 0 0 1 0 1.5H2.75ZM8.75 1.75a.75.75 0 0 0-1.5 0v7.19L5.53 7.22a.75.75 0 0 0-1.06 1.06l3 3a.75.75 0 0 0 1.06 0l3-3a.75.75 0 1 0-1.06-1.06L8.75 8.94V1.75Z" />
                </svg>
              )}
              {downloading ? "Generating..." : "Download PDF"}
            </button>
          )}
          {isComplete && (
            <button
              onClick={() => setShowChat(!showChat)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors hidden lg:block"
            >
              {showChat ? "Hide Chat" : "Show Chat"}
            </button>
          )}
        </div>
      </header>

      {/* Main content — responsive */}
      <div className="flex flex-1 min-h-0 overflow-hidden flex-col lg:flex-row">
        {/* Left sidebar — Agent Activity */}
        <aside className="w-full lg:w-72 xl:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-border p-4 sm:p-5 overflow-y-auto">
          <AgentActivityFeed status={analysis.status} retryCount={analysis.retryCount} />

          {analysis.status === "error" && analysis.error && (
            <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 animate-fade-in">
              <p className="text-xs font-medium text-red-400 mb-1">Error</p>
              <p className="text-xs text-red-400/80">{analysis.error}</p>
            </div>
          )}
        </aside>

        {/* Center — Report */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {isComplete && analysis.report ? (
            <div className="max-w-3xl mx-auto">
              <ReportViewer ref={reportRef} report={analysis.report} />
            </div>
          ) : analysis.status === "error" ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center animate-fade-in">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
                  <span className="text-red-400 text-xl">!</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  Analysis failed. See error details in the sidebar.
                </p>
                <Link
                  href="/"
                  className="mt-2 text-xs text-accent hover:underline"
                >
                  Try again
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-4 animate-fade-in">
                <div className="relative">
                  <div className="h-12 w-12 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <p className="text-foreground font-medium text-sm">
                    Analyzing {analysis.input.companyName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {STATUS_LABELS[analysis.status]}...
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right sidebar — Chat (desktop only when report is complete) */}
        {isComplete && showChat && (
          <aside className="w-full lg:w-80 xl:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-border p-4 sm:p-5 flex flex-col min-h-0 max-h-[400px] lg:max-h-none">
            <ChatPanel
              analysisId={id}
              messages={chatMessages}
              onSendMessage={handleSendMessage}
              loading={chatLoading}
              input={chatInput}
              onInputChange={setChatInput}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

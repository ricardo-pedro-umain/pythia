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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatSeededRef = useRef(false);
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
    // Server-Sent Events stream — the server pushes a fresh
    // PythiaAnalysisState snapshot on every store update and closes the
    // connection once the analysis reaches a terminal state.
    const es = new EventSource(`/api/analysis/${id}/stream`);

    es.onmessage = (event) => {
      try {
        const data: PythiaAnalysisState = JSON.parse(event.data);
        setAnalysis(data);
        // Seed chat history from the server exactly once so we don't
        // clobber in-flight local messages on later updates.
        if (!chatSeededRef.current && data.chatMessages?.length) {
          setChatMessages(data.chatMessages);
        }
        chatSeededRef.current = true;
      } catch {
        /* malformed frame — ignore */
      }
    };

    es.onerror = () => {
      // The browser auto-reconnects by default. Only surface an error if
      // we never received any state at all (e.g. 404 at open time).
      setAnalysis((prev) => {
        if (!prev) setError("Failed to fetch analysis status");
        return prev;
      });
    };

    return () => {
      es.close();
    };
  }, [id]);

  const handleDownloadPdf = useCallback(() => {
    if (!reportRef.current) return;

    // Extract the rendered report HTML (inside the report-prose wrapper)
    const prose = reportRef.current.querySelector(".report-prose");
    const bodyHtml = prose ? prose.innerHTML : reportRef.current.innerHTML;
    const company = analysis?.input.companyName ?? "Report";

    // Open a minimal print window that carries only light-theme styles —
    // completely bypasses the dark app theme that was causing html2canvas issues.
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pythia — ${company}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 14px; }
    body {
      background: #f0eeeb;
      color: #44403c;
      font-family: Georgia, 'Times New Roman', serif;
      padding: 48px 56px;
      line-height: 1.7;
    }
    h1 { font-size: 1.75rem; margin-top: 0; margin-bottom: 1rem; color: #1c1917; font-family: system-ui, sans-serif; }
    h2 { font-size: 1.2rem; margin-top: 2rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid #d6d3d1; color: #1c1917; font-family: system-ui, sans-serif; }
    h3 { font-size: 1.05rem; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #292524; font-family: system-ui, sans-serif; }
    h4, h5, h6 { margin-top: 1rem; margin-bottom: 0.5rem; color: #292524; font-family: system-ui, sans-serif; }
    p { margin-bottom: 0.75rem; }
    ul, ol { margin-bottom: 0.75rem; padding-left: 1.5rem; }
    li { margin-bottom: 0.25rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.875rem; font-family: system-ui, sans-serif; }
    th { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid #d6d3d1; color: #1c1917; font-weight: 600; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #e7e5e4; color: #57534e; }
    blockquote { border-left: 3px solid #6366f1; padding-left: 1rem; margin-left: 0; color: #78716c; font-style: italic; margin-bottom: 0.75rem; }
    code { font-family: monospace; font-size: 0.85em; background: #f5f5f4; padding: 0.15rem 0.4rem; border-radius: 0.25rem; color: #44403c; }
    pre { background: #f5f5f4; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 0.75rem; }
    a { color: #4f46e5; text-decoration: none; }
    strong { color: #1c1917; font-weight: 600; }
    em { font-style: italic; }
    hr { border: none; border-top: 1px solid #d6d3d1; margin: 1.5rem 0; }
    @media print {
      body { padding: 0; background: white; }
      @page { margin: 1.8cm; size: A4; }
      h2 { page-break-after: avoid; }
      h3 { page-break-after: avoid; }
      table { page-break-inside: avoid; }
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`);
    win.document.close();

    // Give the browser a moment to finish rendering, then trigger print/save.
    setTimeout(() => {
      win.focus();
      win.print();
    }, 400);
  }, [analysis]);

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
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:bg-accent/90 hidden sm:inline-flex"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M2.75 14a.75.75 0 0 1 0-1.5h10.5a.75.75 0 0 1 0 1.5H2.75ZM8.75 1.75a.75.75 0 0 0-1.5 0v7.19L5.53 7.22a.75.75 0 0 0-1.06 1.06l3 3a.75.75 0 0 0 1.06 0l3-3a.75.75 0 1 0-1.06-1.06L8.75 8.94V1.75Z" />
              </svg>
              Download PDF
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
          <AgentActivityFeed
            status={analysis.status}
            retryCount={analysis.retryCount}
            stepDurations={analysis.stepDurations}
          />

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

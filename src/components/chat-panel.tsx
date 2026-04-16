"use client";

import { useRef, useEffect } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  analysisId: string;
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  loading: boolean;
  input: string;
  onInputChange: (value: string) => void;
}

export function ChatPanel({
  analysisId: _analysisId,
  messages,
  onSendMessage,
  loading,
  input,
  onInputChange,
}: ChatPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasMessages = messages.length > 0 || loading;

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onSendMessage(input.trim());
  }

  const inputForm = (
    <form onSubmit={handleSubmit} className="flex gap-2 shrink-0">
      <input
        type="text"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Ask a question..."
        className="flex-1 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-colors"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !input.trim()}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
        </svg>
      </button>
    </form>
  );

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-y-auto animate-slide-in-right">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 shrink-0">
        Ask Pythia
      </h2>

      {!hasMessages && (
        <div className="flex flex-col gap-2 mb-4">
          <p className="text-sm text-muted-foreground/50">
            Ask follow-up questions about the analysis:
          </p>
          <div className="flex flex-col gap-1.5 mb-2">
            {[
              "What's their biggest risk?",
              "How do they compare to competitors?",
              "What data are you least confident about?",
            ].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onInputChange(suggestion)}
                className="text-left text-xs text-muted-foreground/60 hover:text-accent px-3 py-1.5 rounded-md border border-transparent hover:border-border/50 hover:bg-muted/30 transition-colors"
              >
                &ldquo;{suggestion}&rdquo;
              </button>
            ))}
          </div>
        </div>
      )}

      {hasMessages && (
        <div className="space-y-3 mb-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-lg px-3.5 py-2.5 text-sm animate-slide-up ${
                msg.role === "user"
                  ? "bg-accent/10 border border-accent/20 text-foreground ml-6"
                  : "bg-card border border-border/50 text-muted-foreground mr-4"
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 opacity-50">
                {msg.role === "user" ? "You" : "Pythia"}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          ))}
          {loading && (
            <div className="bg-card border border-border/50 rounded-lg px-3.5 py-2.5 text-sm text-muted-foreground mr-4 animate-fade-in">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 opacity-50">
                Pythia
              </p>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>
      )}

      {inputForm}
    </div>
  );
}

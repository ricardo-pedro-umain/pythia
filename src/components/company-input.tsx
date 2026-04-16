"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CompanyInput() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          url: url.trim() || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to start analysis");
      }

      const data = await res.json();
      router.push(`/analysis/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="companyName" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Company Name
        </label>
        <input
          id="companyName"
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g. Stripe, Figma, Anthropic"
          className="rounded-lg border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-colors"
          disabled={loading}
          autoFocus
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="url" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Website URL <span className="opacity-40 normal-case">(optional)</span>
        </label>
        <input
          id="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="rounded-lg border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 transition-colors"
          disabled={loading}
        />
      </div>

      {error && (
        <p className="text-sm text-red-400 animate-fade-in">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !companyName.trim()}
        className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 font-medium text-white transition-all hover:bg-accent/90 hover:shadow-[0_0_20px_-4px_rgba(99,102,241,0.4)] disabled:opacity-40 disabled:hover:bg-accent disabled:hover:shadow-none"
      >
        {loading && (
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {loading ? "Starting Analysis..." : "Analyze Company"}
      </button>
    </form>
  );
}

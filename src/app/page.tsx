import { CompanyInput } from "@/components/company-input";
import { RecentAnalyses, SavedCompanies } from "@/components/recent-analyses";

export default function Home() {
  return (
    <div className="flex flex-1 relative">
      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(99,102,241,0.08)_0%,_transparent_70%)]" />

      {/* Main content — centered */}
      <div className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
        <div className="relative flex flex-col items-center gap-4 text-center animate-slide-up">
          <h1 className="text-6xl font-bold tracking-tight bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent sm:text-7xl">
            Pythia
          </h1>
          <p className="text-lg text-muted-foreground max-w-md leading-relaxed">
            Enter a company name and get a comprehensive due diligence briefing
            powered by a team of AI agents.
          </p>
        </div>

        <div className="relative w-full max-w-lg animate-slide-up" style={{ animationDelay: "150ms" }}>
          <CompanyInput />
        </div>

        <div className="relative w-full max-w-lg animate-fade-in" style={{ animationDelay: "300ms" }}>
          <RecentAnalyses />
        </div>

        <p className="relative text-xs text-muted-foreground/40 animate-fade-in" style={{ animationDelay: "400ms" }}>
          Typically takes 2-4 minutes depending on data availability
        </p>
      </div>

      {/* Floating company list — right side, aligned with "Company Name" label area */}
      <div className="hidden lg:block fixed right-8 top-1/2 -translate-y-1/2 w-48 animate-fade-in" style={{ animationDelay: "500ms" }}>
        <SavedCompanies />
      </div>
    </div>
  );
}

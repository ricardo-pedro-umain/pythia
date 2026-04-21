import { CompanyInput } from "@/components/company-input";
import { RecentAnalyses } from "@/components/recent-analyses";

export default function Home() {
  return (
    <div className="flex flex-1 relative">
      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(99,102,241,0.08)_0%,_transparent_70%)]" />

      {/* Main content — centered */}
      <div className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
        <div className="relative flex flex-col items-center gap-4 text-center animate-slide-up">
          {/* Heading + floating definition */}
          <div className="relative inline-block">
            <h1 className="text-6xl font-bold tracking-tight bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent sm:text-7xl">
              Pythia
            </h1>
            {/* Quote floats to the right of the heading on large screens */}
            <aside className="absolute top-1/2 left-[calc(100%+1.75rem)] -translate-y-1/2 w-52 hidden lg:block">
              <p className="text-[11px] italic text-muted-foreground/35 leading-relaxed border-l border-muted-foreground/15 pl-3">
                the high priestess of the Temple of Apollo at Delphi, renowned in ancient Greece as the Oracle of Delphi
              </p>
            </aside>
          </div>
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
      </div>
    </div>
  );
}

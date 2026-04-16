"use client";

import { forwardRef } from "react";
import ReactMarkdown from "react-markdown";

export const ReportViewer = forwardRef<HTMLDivElement, { report: string }>(
  function ReportViewer({ report }, ref) {
    return (
      <div
        ref={ref}
        className="animate-fade-in rounded-xl bg-[#f0eeeb] border border-[#ddd9d3] shadow-sm p-6 sm:p-8 lg:p-10"
      >
        <div className="report-prose">
          <ReactMarkdown>{report}</ReactMarkdown>
        </div>
      </div>
    );
  }
);

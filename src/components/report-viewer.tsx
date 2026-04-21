"use client";

import { forwardRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

// All links in the report open in a new tab
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export const ReportViewer = forwardRef<HTMLDivElement, { report: string }>(
  function ReportViewer({ report }, ref) {
    return (
      <div
        ref={ref}
        className="animate-fade-in rounded-xl bg-[#f0eeeb] border border-[#ddd9d3] shadow-sm p-6 sm:p-8 lg:p-10"
      >
        <div className="report-prose">
          <ReactMarkdown components={markdownComponents}>{report}</ReactMarkdown>
        </div>
      </div>
    );
  }
);

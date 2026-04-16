export function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 0.7
      ? "bg-emerald-500/20 text-emerald-400"
      : score >= 0.4
        ? "bg-yellow-500/20 text-yellow-400"
        : "bg-red-500/20 text-red-400";

  const icon = score >= 0.7 ? "\u{1F7E2}" : score >= 0.4 ? "\u{1F7E1}" : "\u{1F534}";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono ${color}`}
    >
      {icon} {(score * 100).toFixed(0)}%
    </span>
  );
}

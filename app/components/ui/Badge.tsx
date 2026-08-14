import type { ReactNode } from "react";

type BadgeTone = "success" | "warning" | "critical" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  critical: "bg-critical-bg text-critical",
  info: "bg-accent/10 text-accent",
  neutral: "bg-surface text-muted",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

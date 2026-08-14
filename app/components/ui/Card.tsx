import type { ReactNode } from "react";

export const CARD_CLASSES = "rounded-lg border border-border bg-bg p-4";

export const CARD_INTERACTIVE_CLASSES =
  "rounded-lg border border-border bg-bg p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${CARD_CLASSES} ${className}`}>{children}</div>;
}

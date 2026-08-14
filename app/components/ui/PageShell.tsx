import type { ReactNode } from "react";

export function PageShell({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-ink">{heading}</h1>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

import type { SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

export function Select({ label, name, id, children, ...props }: SelectProps) {
  const fieldId = id ?? `select-${name}`;
  return (
    <label htmlFor={fieldId} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <select
        id={fieldId}
        name={name}
        className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

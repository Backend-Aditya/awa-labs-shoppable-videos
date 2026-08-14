import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, name, id, ...props }: TextFieldProps) {
  const fieldId = id ?? `field-${name}`;
  return (
    <label htmlFor={fieldId} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        id={fieldId}
        name={name}
        className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
        {...props}
      />
    </label>
  );
}

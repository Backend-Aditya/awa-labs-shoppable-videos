import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "critical" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-ink hover:bg-primary/90 focus-visible:outline-primary",
  secondary:
    "border border-border bg-bg text-ink hover:bg-surface focus-visible:outline-primary",
  critical:
    "border border-critical/30 bg-critical-bg text-critical hover:bg-critical/15 focus-visible:outline-critical",
  ghost: "text-ink hover:bg-surface focus-visible:outline-primary",
};

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "variant"> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}

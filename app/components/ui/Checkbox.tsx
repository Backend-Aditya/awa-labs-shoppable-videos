import { useId, type InputHTMLAttributes } from "react";

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Checkbox({ label, name, value, id, ...props }: CheckboxProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <label htmlFor={fieldId} className="flex items-center gap-2 text-sm text-ink">
      <input
        id={fieldId}
        type="checkbox"
        name={name}
        value={value}
        className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
        {...props}
      />
      {label}
    </label>
  );
}

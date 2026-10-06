// Polaris web components (s-text-field, s-text-area, s-checkbox, ...) don't
// yet cover a color swatch, a bounded number input, a native <select>, or a
// datetime picker — app.widgets.tsx and app.reels.tsx each hand-rolled these
// with an identical inline style object. One shared, consistently styled set
// of fields instead of that duplicated styling and markup.
import type { CSSProperties, ReactNode } from "react";

export const FIELD_INPUT_STYLE: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid var(--p-color-border, #c9cccf)",
  fontSize: "14px",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor}>
      <s-text>{children}</s-text>
    </label>
  );
}

export function NumberField({
  id,
  name,
  label,
  min,
  max,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
}) {
  return (
    <s-stack gap="small-100">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="number"
        name={name}
        min={min}
        max={max}
        defaultValue={defaultValue}
        style={FIELD_INPUT_STYLE}
      />
    </s-stack>
  );
}

export function SelectField({
  id,
  name,
  label,
  defaultValue,
  options,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <s-stack gap="small-100">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select id={id} name={name} defaultValue={defaultValue} style={FIELD_INPUT_STYLE}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </s-stack>
  );
}

export function ColorField({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <label htmlFor={id} style={{ fontSize: "13px" }}>
        {label}
      </label>
      <input
        id={id}
        type="color"
        name={name}
        defaultValue={defaultValue}
        style={{ width: "40px", height: "32px", padding: 0, border: "none", cursor: "pointer" }}
      />
    </s-stack>
  );
}

export function DateTimeField({
  id,
  name,
  label,
  defaultValue,
  helpText,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  helpText?: ReactNode;
}) {
  return (
    <s-stack gap="small-100">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input id={id} type="datetime-local" name={name} defaultValue={defaultValue} style={FIELD_INPUT_STYLE} />
      {helpText && <s-text color="subdued">{helpText}</s-text>}
    </s-stack>
  );
}

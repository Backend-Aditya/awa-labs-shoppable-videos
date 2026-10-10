// Controlled inputs for the widget editor. Native elements styled to sit
// alongside Polaris rather than s-* web components: the editor needs fully
// controlled values (they drive the live preview on every keystroke), and
// s-checkbox/s-select form participation proved unreliable in this app (see
// the old hidden-input workarounds this replaced).
import type { ReactNode } from "react";
import { useId } from "react";
import styles from "./editor.module.css";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      {htmlFor ? (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className={styles.label}>{label}</span>
      )}
      {children}
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength = 80,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        className={styles.input}
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </Field>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className={styles.segmented} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className={styles.segment}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </Field>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <label htmlFor={id} className={styles.toggleLabel}>
          {label}
        </label>
        {description && <p className={styles.hint}>{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchThumb} />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <div className={styles.sliderRow}>
        <input
          id={id}
          className={styles.range}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
        />
        <output className={styles.sliderValue} htmlFor={id}>
          {value}
          {unit}
        </output>
      </div>
    </Field>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

// Swatch + hex text box. `allowEmpty` adds a chip (default "Theme") that
// stores "", which the storefront reads as "inherit" — from the theme, or
// from the brand kit when `emptyLabel` is "Brand".
export function ColorInput({
  label,
  value,
  onChange,
  allowEmpty = false,
  fallback = "#141414",
  emptyLabel = "Theme",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  fallback?: string;
  emptyLabel?: string;
}) {
  const id = useId();
  const isEmpty = value === "";
  return (
    <div className={styles.colorRow}>
      <label className={styles.colorLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.colorControls}>
        {allowEmpty && (
          <button
            type="button"
            className={styles.themeChip}
            aria-pressed={isEmpty}
            onClick={() => onChange(isEmpty ? fallback : "")}
            title={isEmpty ? `Using the ${emptyLabel.toLowerCase()} color` : `Use the ${emptyLabel.toLowerCase()} color`}
          >
            {emptyLabel}
          </button>
        )}
        <span className={styles.swatchWrap} data-empty={isEmpty || undefined}>
          <input
            id={id}
            type="color"
            className={styles.swatch}
            value={isEmpty ? fallback : value}
            onChange={(e) => onChange(e.currentTarget.value)}
            aria-label={`${label} color`}
          />
        </span>
        <input
          className={styles.hexInput}
          type="text"
          value={isEmpty ? "" : value}
          placeholder={isEmpty ? emptyLabel : "#000000"}
          spellCheck={false}
          aria-label={`${label} hex value`}
          maxLength={7}
          onChange={(e) => {
            const next = e.currentTarget.value.trim();
            if (next === "" && allowEmpty) onChange("");
            else if (HEX.test(next)) onChange(next.toLowerCase());
          }}
        />
      </div>
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          {description && <p className={styles.hint}>{description}</p>}
        </div>
        {action}
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

export function ChipToggleGroup({
  label,
  hint,
  options,
  selected,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className={styles.chips}>
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={styles.chip}
              aria-pressed={on}
              onClick={() =>
                onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value])
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

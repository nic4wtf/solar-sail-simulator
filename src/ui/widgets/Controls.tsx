/**
 * Shared form and layout widgets.
 *
 * Every numeric input is a `NumberField`, which owns the SI <-> display unit
 * conversion and the validation message. Keeping that in one place is what
 * stops display units leaking into the physics.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/**
 * Small info affordance. Uses a click-to-open popover rather than a hover
 * title so the text is reachable on touch devices and can contain equations.
 */
export function Info({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="info" ref={ref}>
      <button
        type="button"
        className="info-btn"
        aria-label="More information"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && <span className="info-pop">{children}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  /** Unit shown to the right of the label. Always spell it out. */
  unit?: string;
  help?: ReactNode;
  /** Validation or advisory message shown beneath the control. */
  message?: string;
  messageKind?: 'warning' | 'error' | 'info';
  children: ReactNode;
  htmlFor?: string;
}

export function Field({
  label,
  unit,
  help,
  message,
  messageKind = 'warning',
  children,
  htmlFor,
}: FieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        <span className="field-label-text">{label}</span>
        {unit && <span className="field-unit">{unit}</span>}
        {help && <Info>{help}</Info>}
      </label>
      <div className="field-control">{children}</div>
      {message && <div className={`field-msg field-msg-${messageKind}`}>{message}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumberField
// ---------------------------------------------------------------------------

interface NumberFieldProps {
  label: string;
  /** Unit label, spelled out (e.g. "m^2/kg", "deg", "km"). */
  unit?: string;
  /** Value in DISPLAY units. */
  value: number;
  /** Called with the new value in DISPLAY units. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places shown when the field is not focused. */
  decimals?: number;
  help?: ReactNode;
  /** External advisory message (validation warnings from the model). */
  message?: string;
  messageKind?: 'warning' | 'error' | 'info';
  disabled?: boolean;
  /** Show a range slider alongside the numeric entry. */
  slider?: boolean;
}

/**
 * Numeric entry that keeps the user's raw keystrokes while focused and only
 * commits parseable values.
 *
 * This matters more than it looks: a naive controlled number input rewrites
 * the field on every keystroke, so typing "-" or "1e" or "0." either gets
 * eaten or commits a garbage value mid-edit. Here the text is held locally
 * during editing and reformatted on blur.
 */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
  help,
  message,
  messageKind = 'warning',
  disabled,
  slider,
}: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const display =
    text ??
    (decimals !== undefined
      ? value.toFixed(decimals)
      : String(Number(value.toPrecision(10))));

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        setLocalError('Enter a value');
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setLocalError('Not a number');
        return;
      }
      if (min !== undefined && parsed < min) {
        setLocalError(`Minimum is ${min}`);
        onChange(min);
        setText(null);
        return;
      }
      if (max !== undefined && parsed > max) {
        setLocalError(`Maximum is ${max}`);
        onChange(max);
        setText(null);
        return;
      }
      setLocalError(null);
      onChange(parsed);
    },
    [max, min, onChange],
  );

  return (
    <Field
      label={label}
      unit={unit}
      help={help}
      htmlFor={id}
      message={localError ?? message}
      messageKind={localError ? 'error' : messageKind}
    >
      <div className={slider ? 'num-with-slider' : undefined}>
        <input
          id={id}
          className="num-input"
          type="text"
          inputMode="decimal"
          value={display}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            const parsed = Number(e.target.value.trim());
            // Live-commit only unambiguous values, so dragging a slider or
            // typing a complete number updates the readouts immediately.
            if (e.target.value.trim() !== '' && Number.isFinite(parsed)) {
              if (
                (min === undefined || parsed >= min) &&
                (max === undefined || parsed <= max)
              ) {
                setLocalError(null);
                onChange(parsed);
              }
            }
          }}
          onBlur={(e) => {
            commit(e.target.value);
            setText(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value);
              setText(null);
            }
          }}
        />
        {slider && min !== undefined && max !== undefined && (
          <input
            className="num-slider"
            type="range"
            min={min}
            max={max}
            step={step ?? (max - min) / 200}
            value={Math.min(max, Math.max(min, value))}
            disabled={disabled}
            onChange={(e) => {
              setText(null);
              setLocalError(null);
              onChange(Number(e.target.value));
            }}
          />
        )}
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// SelectField
// ---------------------------------------------------------------------------

interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  help?: ReactNode;
  message?: string;
  messageKind?: 'warning' | 'error' | 'info';
  disabled?: boolean;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  help,
  message,
  messageKind,
  disabled,
}: SelectFieldProps<T>) {
  const id = useId();
  return (
    <Field label={label} help={help} htmlFor={id} message={message} messageKind={messageKind}>
      <select
        id={id}
        className="select-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

export function CheckField({
  label,
  checked,
  onChange,
  help,
  disabled,
  message,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: ReactNode;
  disabled?: boolean;
  message?: string;
}) {
  const id = useId();
  return (
    <div className="check-field">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
      {help && <Info>{help}</Info>}
      {message && <div className="field-msg field-msg-warning">{message}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Section({
  title,
  children,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      {subtitle && <p className="section-subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

/** Collapsible group, for advanced settings that should not dominate a panel. */
export function Collapsible({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="collapsible-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-caret">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {badge && <span className="badge">{badge}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

/** A labelled read-only value. The workhorse of the results panels. */
export function Readout({
  label,
  value,
  help,
  emphasis,
  kind,
}: {
  label: string;
  value: ReactNode;
  help?: ReactNode;
  emphasis?: boolean;
  kind?: 'good' | 'bad' | 'neutral';
}) {
  return (
    <div className={`readout ${emphasis ? 'readout-emphasis' : ''}`}>
      <span className="readout-label">
        {label}
        {help && <Info>{help}</Info>}
      </span>
      <span className={`readout-value ${kind ? `readout-${kind}` : ''}`}>{value}</span>
    </div>
  );
}

/** Grid of readouts. */
export function ReadoutGrid({ children }: { children: ReactNode }) {
  return <div className="readout-grid">{children}</div>;
}

export type NoticeKind = 'info' | 'warning' | 'error' | 'success';

/** Inline notice used for all model warnings and validation messages. */
export function Notice({
  kind = 'info',
  title,
  children,
}: {
  kind?: NoticeKind;
  title?: string;
  children: ReactNode;
}) {
  const glyph = kind === 'error' ? '!' : kind === 'warning' ? '!' : kind === 'success' ? '✓' : 'i';
  return (
    <div className={`notice notice-${kind}`}>
      <span className="notice-glyph" aria-hidden="true">
        {glyph}
      </span>
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Informative empty state, so a panel is never just blank. */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Equation block for the physics documentation. */
export function Equation({ children }: { children: ReactNode }) {
  return <pre className="equation">{children}</pre>;
}

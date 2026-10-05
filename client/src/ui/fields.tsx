// Small controlled inputs that commit on Enter / blur, so typing does not
// spam the operation log.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { inToMm, mmToIn } from '@conquest/shared';

export function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    // A group rather than a <label>: rows often hold several buttons, and a
    // label would forward clicks on its text to the first one.
    <div className="row" role="group" aria-label={label} title={title}>
      <span className="row-label">{label}</span>
      <span className="row-value">{children}</span>
    </div>
  );
}

const fmt = (n: number | undefined, digits: number) => (n === undefined || Number.isNaN(n) ? '' : String(Math.round(n * 10 ** digits) / 10 ** digits));

export function NumberField(props: {
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  allowEmpty?: boolean;
  disabled?: boolean;
  width?: number;
  suffix?: string;
  title?: string;
}) {
  const { value, onCommit, digits = 2 } = props;
  const [text, setText] = useState(fmt(value, digits));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value, digits));
  }, [value, digits]);
  const commit = () => {
    const t = text.trim();
    if (t === '') {
      if (props.allowEmpty) {
        if (value !== undefined) onCommit(undefined);
      } else setText(fmt(value, digits));
      return;
    }
    let n = Number(t);
    if (!Number.isFinite(n)) {
      setText(fmt(value, digits));
      return;
    }
    if (props.min !== undefined) n = Math.max(props.min, n);
    if (props.max !== undefined) n = Math.min(props.max, n);
    setText(fmt(n, digits));
    if (n !== value) onCommit(n);
  };
  return (
    <span className="num">
      <input
        type="number"
        inputMode="decimal"
        value={text}
        step={props.step ?? 0.1}
        min={props.min}
        max={props.max}
        disabled={props.disabled}
        title={props.title}
        style={{ width: props.width ?? 64 }}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value, digits));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {props.suffix && <span className="suffix">{props.suffix}</span>}
    </span>
  );
}

/**
 * A length stored in inches. The user may type it in millimetres instead;
 * the value is converted at once (1" = 25.4 mm) and only inches are stored.
 */
export function LengthField(props: { value: number; onCommit: (inches: number) => void; disabled?: boolean; min?: number }) {
  const [unit, setUnit] = useState<'in' | 'mm'>('in');
  const shown = unit === 'in' ? props.value : inToMm(props.value);
  return (
    <span className="num">
      <NumberField
        value={shown}
        digits={unit === 'in' ? 2 : 1}
        min={props.min ?? 0.01}
        step={unit === 'in' ? 0.1 : 1}
        disabled={props.disabled}
        onCommit={(n) => n !== undefined && props.onCommit(unit === 'in' ? n : mmToIn(n))}
      />
      <button type="button" className="unit" onClick={() => setUnit(unit === 'in' ? 'mm' : 'in')} title="Switch input unit (stored in inches)">
        {unit === 'in' ? 'in' : 'mm'}
      </button>
    </span>
  );
}

export function TextField(props: { value: string; onCommit: (s: string) => void; placeholder?: string; disabled?: boolean }) {
  const [text, setText] = useState(props.value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(props.value);
  }, [props.value]);
  return (
    <input
      type="text"
      value={text}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (text !== props.value) props.onCommit(text);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(props.value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Multi-line notes, autosaved a moment after typing stops. */
export function NotesField(props: { value: string; onCommit: (s: string) => void; placeholder?: string }) {
  const [text, setText] = useState(props.value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(props.onCommit);
  latest.current = props.onCommit;
  useEffect(() => {
    if (!focused.current) setText(props.value);
  }, [props.value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const schedule = (t: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (t !== props.value) latest.current(t);
    }, 1000);
  };
  return (
    <textarea
      rows={4}
      value={text}
      placeholder={props.placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        clearTimeout(timer.current);
        if (text !== props.value) props.onCommit(text);
      }}
      onChange={(e) => {
        setText(e.target.value);
        schedule(e.target.value);
      }}
    />
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

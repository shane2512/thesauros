'use client';
// Referenced by progress-metric-card.tsx but not supplied in the pasted spec — built here to match
// its expected API exactly (a period dropdown + a curve/bars view toggle).
import { BarChart3, ChevronDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import type { ChartView } from './metric-chart';

export type PeriodOption = { label: string; points?: number };

export function PeriodSelect({
  value,
  options,
  onChange,
  accentText,
}: {
  value: string;
  options: PeriodOption[];
  onChange: (option: PeriodOption) => void;
  accentText: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="pointer-events-auto flex items-center gap-1 text-small font-medium text-muted hover:text-ink"
      >
        {value}
        <ChevronDown className="size-3.5" style={{ color: accentText }} aria-hidden="true" />
      </button>
      {open ? (
        <ul
          role="listbox"
          className="glass-sheet pointer-events-auto absolute top-full right-0 z-20 mt-1 min-w-[9rem] rounded-md py-1 text-small"
        >
          {options.map((o) => (
            <li key={o.label}>
              <button
                type="button"
                role="option"
                aria-selected={o.label === value}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left hover:bg-surface-2 ${o.label === value ? 'font-semibold text-ink' : 'text-muted'}`}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ViewToggle({
  value,
  onChange,
}: {
  value: ChartView;
  onChange: (view: ChartView) => void;
}) {
  const opts: { view: ChartView; Icon: typeof TrendingUp; label: string }[] = [
    { view: 'curve', Icon: TrendingUp, label: 'Line view' },
    { view: 'bars', Icon: BarChart3, label: 'Bar view' },
  ];
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
      {opts.map(({ view, Icon, label }) => (
        <button
          key={view}
          type="button"
          aria-label={label}
          aria-pressed={value === view}
          onClick={() => onChange(view)}
          className={`flex size-6 items-center justify-center rounded-full ${
            value === view ? 'bg-surface-3 text-ink' : 'text-faint hover:text-muted'
          }`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

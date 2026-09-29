'use client';
// Expanded decision: the tabs Context, Proposal, Verifier, Policy checks, Simulation, Transaction.
// Presentational over `DecisionDetail` from the API. Every rule sentence arrives from the server's
// own `ruleSentences` table (packages/policy), so this file never re-derives what a rule means. No
// raw JSON is shown anywhere.
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconExternal } from '@/components/icons';
import { Money, VerdictBadge, toneOf } from '@/components/primitives';
import { VerdictGlyph, type VerdictTone } from '@/components/icons';
import { ruleLabel } from './DecisionRow';
import type { DecisionDetail, RuleCheck } from '@/lib/contracts';
import { toBig } from '@/lib/format';

export const DETAIL_TABS = [
  'Context',
  'Proposal',
  'Verifier',
  'Policy checks',
  'Simulation',
  'Transaction',
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** PASS / ESCALATE / DENY as glyph + word: pass, needs you, blocked (never colour alone). */
export const CHECK_MARK: Record<
  RuleCheck['result'],
  { tone: VerdictTone; word: string; cls: string }
> = {
  PASS: { tone: 'allow', word: 'Passed', cls: 'text-allow' },
  ESCALATE: { tone: 'escalate', word: 'Needs you', cls: 'text-escalate' },
  DENY: { tone: 'deny', word: 'Blocked', cls: 'text-deny' },
};

const ORDER: Record<RuleCheck['result'], number> = { DENY: 0, ESCALATE: 1, PASS: 2 };

/** The failing checks first (same order the approval sheet uses). */
export const sortChecks = (checks: readonly RuleCheck[]): RuleCheck[] =>
  [...checks].sort((a, b) => ORDER[a.result] - ORDER[b.result]);

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)} ${h.slice(6, 10)} ... ${h.slice(-4)}` : h;
}

const SOURCE_WORDS: Record<string, string> = {
  serv: 'Thesauros reasoned about this and proposed it.',
  deterministic: 'Fixed rules worked this out. No model was involved in choosing it.',
  owner: 'You asked for this.',
};

function Section({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="space-y-3 text-small" aria-label={label}>
      {children}
    </div>
  );
}

export function PolicyChecks({ checks }: { checks: RuleCheck[] }) {
  if (checks.length === 0)
    return <p className="text-small text-muted">No rules ran for this decision.</p>;
  return (
    <ul className="space-y-3" data-testid="policy-checks">
      {sortChecks(checks).map((c) => {
        const m = CHECK_MARK[c.result];
        return (
          <li key={c.code} className="flex items-start gap-2 text-small">
            <VerdictGlyph tone={m.tone} className={`mt-1 size-3.5 shrink-0 ${m.cls}`} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-mono text-faint">{ruleLabel(c.code)}</span>
                <span className={`font-medium ${m.cls}`}>{m.word}</span>
              </span>
              <span className="block text-ink">{c.sentence}</span>
              {c.message ? <span className="block text-muted">{c.message}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function TxLink({ hash, explorerBase }: { hash: string; explorerBase: string }) {
  return (
    <a
      href={`${explorerBase}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`View transaction ${hash} on the block explorer`}
      className="inline-flex min-h-11 items-center gap-2 font-mono text-mono text-accent-ink hover:underline"
    >
      tx {shortHash(hash)}
      <IconExternal className="size-4" />
    </a>
  );
}

function panel(d: DecisionDetail, tab: DetailTab, explorerBase: string): React.ReactNode {
  switch (tab) {
    case 'Context':
      return (
        <Section>
          <p className="text-muted">What Thesauros could see when it decided.</p>
          <dl className="space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Trigger</dt>
              <dd className="text-right text-ink capitalize">{d.decision.trigger}</dd>
            </div>
            {d.decision.proposalKind ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Kind</dt>
                <dd className="text-right text-ink capitalize">
                  {d.decision.proposalKind.replace(/_/g, ' ')}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Status</dt>
              <dd className="text-right text-ink capitalize">{d.decision.status}</dd>
            </div>
          </dl>
        </Section>
      );
    case 'Proposal':
      return (
        <Section>
          <p className="text-ink">
            {d.decision.amount !== null ? (
              <>
                Thesauros proposed: {d.decision.title},{' '}
                <Money base={toBig(d.decision.amount)} usd />.
              </>
            ) : (
              <>Thesauros proposed: {d.decision.title}.</>
            )}
          </p>
          <p className="text-muted">
            {SOURCE_WORDS[d.decision.proposalSource] ??
              'The source of this proposal was not recorded.'}
          </p>
          {d.decision.rationale ? (
            <p className="text-ink">
              <span className="text-muted">Why: </span>
              {d.decision.rationale}
            </p>
          ) : null}
        </Section>
      );
    case 'Verifier':
      return (
        <Section>
          <p className="text-muted">
            No second opinion was needed. Fixed rules decided this on their own.
          </p>
        </Section>
      );
    case 'Policy checks':
      return (
        <Section>
          {d.verdict ? (
            <p className="text-muted">
              Checked against policy v{d.verdict.policyVersion}. These are the rules that decided
              it.
            </p>
          ) : null}
          <PolicyChecks checks={d.verdict?.checks ?? []} />
        </Section>
      );
    case 'Simulation':
      return (
        <Section>
          {d.simulation === null ? (
            <p className="text-muted">Nothing was simulated for this decision.</p>
          ) : d.simulation.ok ? (
            <>
              <p className="text-ink">The exact calls were simulated first and did not revert.</p>
              <p className="text-muted">You would have seen these changes:</p>
              <ul className="space-y-1">
                {d.simulation.deltas.map((x, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span className="text-muted capitalize">{x.holder}</span>
                    <span className="tabular text-ink">{x.delta}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-deny">
              The simulation failed{d.simulation.error ? `: ${d.simulation.error}` : ''}. Nothing
              was sent.
            </p>
          )}
        </Section>
      );
    case 'Transaction':
      return (
        <Section>
          {d.execution?.txHash ? (
            <>
              <p className="text-ink">
                {d.execution.status === 'confirmed'
                  ? 'The transaction is confirmed on chain.'
                  : `Transaction status: ${d.execution.status}.`}
              </p>
              <TxLink hash={d.execution.txHash} explorerBase={explorerBase} />
            </>
          ) : (
            <p className="text-muted">
              {d.execution?.error
                ? `Thesauros tried but did not send a transaction: ${d.execution.error}. Nothing moved.`
                : 'No transaction was sent. Nothing moved.'}
            </p>
          )}
        </Section>
      );
  }
}

export function DecisionDetailView({
  detail,
  explorerBase,
  panelId,
}: {
  detail: DecisionDetail;
  explorerBase: string;
  panelId?: string;
}) {
  const [tab, setTab] = useState<DetailTab>('Policy checks');
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const denied = detail.verdict?.decision === 'DENY';

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = DETAIL_TABS.length;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i + n - 1) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setTab(DETAIL_TABS[next] as DetailTab);
    refs.current[next]?.focus();
  };

  return (
    <div id={panelId} className="rounded-md bg-surface-2 p-4" data-testid="decision-detail">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink">
        {detail.verdict ? <VerdictBadge tone={toneOf(detail.verdict.decision)} /> : null}
        <span>{detail.decision.explanation}</span>
      </p>

      {denied && detail.whyBlocked.length > 0 ? (
        <section aria-labelledby={`${base}-why`} className="mt-4 rounded-md bg-deny-tint p-3">
          <h3 id={`${base}-why`} className="text-h3 font-semibold text-deny">
            Why was this blocked?
          </h3>
          <ul className="space-y-1 pt-2 text-small text-ink">
            {detail.whyBlocked.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div
        role="tablist"
        aria-label="Decision detail"
        className="-mx-1 mt-4 flex gap-1 overflow-x-auto pb-1"
      >
        {DETAIL_TABS.map((t, i) => {
          const on = t === tab;
          return (
            <button
              key={t}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${i}`}
              aria-selected={on}
              aria-controls={`${base}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={(e) => onKey(e, i)}
              className={`relative min-h-11 shrink-0 rounded-full px-3 text-small whitespace-nowrap ${
                on ? 'bg-surface-3 font-semibold text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${DETAIL_TABS.indexOf(tab)}`}
        tabIndex={0}
        className="pt-3 outline-none focus-visible:outline-2"
      >
        {panel(detail, tab, explorerBase)}
      </div>
    </div>
  );
}

'use client';
// Event & proof: one decision, end to end — what was proposed and by whom, what the simulation said
// would change, every rule the Policy Engine ran, and the on-chain transaction. Presentational over
// `DecisionDetail` from the API; every rule sentence arrives from the server's own `ruleSentences`
// table (packages/policy), so this file never re-derives what a rule means.
import { useState, type ReactNode } from 'react';
import {
  IconAgent,
  IconCheck,
  IconCopy,
  IconDownload,
  IconExternal,
  IconFingerprint,
  IconShieldCheck,
  VerdictGlyph,
  type VerdictTone,
} from '@/components/icons';
import {
  Button,
  ErrorPanel,
  Skeleton,
  Tag,
  VerdictBadge,
  toneOf,
  type TagTone,
} from '@/components/primitives';
import { zConfig, zDecisionDetail, type DecisionDetail, type RuleCheck } from '@/lib/contracts';
import { downloadText } from '@/lib/download';
import { formatToken, formatWhen, toBig } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { AuditVerifyResult, useAuditVerify } from './AuditChain';
import { decisionIcon, ruleLabel } from './DecisionRow';

/** PASS / ESCALATE / DENY as glyph + word: passed, needs you, blocked (never colour alone). */
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
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}

const SOURCE_WORDS: Record<string, string> = {
  serv: 'The reasoning model proposed this.',
  deterministic: 'Fixed rules worked this out. No model chose it.',
  owner: 'You asked for this.',
};

function execTag(d: DecisionDetail): { tone: TagTone; word: string } {
  const s = d.execution?.status;
  if (s === 'confirmed') return { tone: 'allow', word: 'Confirmed on chain' };
  if (s === 'failed') return { tone: 'deny', word: 'Execution failed' };
  if (s) return { tone: 'soft', word: `Execution ${s}` };
  if (d.verdict?.decision === 'DENY') return { tone: 'deny', word: 'Blocked, nothing sent' };
  if (d.verdict?.decision === 'ESCALATE') return { tone: 'warn', word: 'Waiting for you' };
  return { tone: 'quiet', word: 'Nothing sent' };
}

function Card({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="card p-4">
      <div className="flex items-center justify-between gap-2 pb-3">
        <span className="label">{label}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

function CopyChip({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? `${label} copied` : `Copy ${label}`}
      onClick={() =>
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          })
          .catch(() => undefined)
      }
      className="flex size-9 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-3 hover:text-ink"
    >
      {done ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
    </button>
  );
}

export function PolicyChecks({ checks }: { checks: RuleCheck[] }) {
  if (checks.length === 0)
    return <p className="text-meta text-muted">No rules ran for this decision.</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="policy-checks">
      {sortChecks(checks).map((c) => {
        const m = CHECK_MARK[c.result];
        return (
          <li
            key={c.code}
            className={`flex items-start gap-2.5 rounded-sm p-3 ${c.result === 'PASS' ? 'bg-surface-2' : c.result === 'DENY' ? 'bg-deny-tint' : 'bg-escalate-tint'}`}
          >
            <VerdictGlyph tone={m.tone} className={`mt-0.5 size-4 shrink-0 ${m.cls}`} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-mono text-fine font-semibold text-ink">
                  {ruleLabel(c.code)}
                </span>
                <span className={`text-cap font-bold ${m.cls}`}>{m.word}</span>
              </span>
              <span className="block pt-0.5 text-meta leading-[18px] text-ink">{c.sentence}</span>
              {c.message ? (
                <span className="block pt-0.5 text-fine leading-4 text-muted">{c.message}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function DecisionDetailView({
  detail: d,
  explorerBase,
}: {
  detail: DecisionDetail;
  explorerBase: string;
}) {
  const verify = useAuditVerify();
  const Icon = decisionIcon(d.decision.proposalKind);
  const tag = execTag(d);
  const checks = d.verdict?.checks ?? [];
  const passed = checks.filter((c) => c.result === 'PASS').length;
  const tx = d.execution?.txHash ?? null;

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-6" data-testid="decision-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tag tone={tag.tone} dot={tag.tone === 'allow' ? 'allow' : undefined}>
          {tag.word}
        </Tag>
        {tx ? (
          <span className="rounded-full bg-card px-2.5 py-1 font-mono text-cap text-muted shadow-e1">
            {shortHash(tx)}
          </span>
        ) : null}
      </div>

      <section aria-label="Event" className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-3 text-ink">
              <Icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="label block">{d.decision.trigger} event</span>
              <span className="block text-h2 leading-6 font-bold text-ink">{d.decision.title}</span>
            </span>
          </span>
          {d.verdict ? <VerdictBadge tone={toneOf(d.verdict.decision)} /> : null}
        </div>
        {d.decision.amount !== null ? (
          <p className="flex items-baseline gap-2 pt-4">
            <span className="tabular text-amount leading-10 font-bold tracking-[-0.02em] text-ink">
              {formatToken(toBig(d.decision.amount))}
            </span>
            <span className="text-lead font-semibold text-muted">USDC</span>
          </p>
        ) : null}
        <p className="pt-2 text-ui leading-5 text-ink">{d.decision.explanation}</p>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-sm bg-surface-2 p-3">
          <span className="flex min-w-0 items-center gap-2 text-meta text-ink">
            <IconAgent className="size-4 shrink-0" />
            <span className="min-w-0">
              {SOURCE_WORDS[d.decision.proposalSource] ??
                'The source of this proposal was not recorded.'}
            </span>
          </span>
          <span className="shrink-0 text-right text-cap text-muted">
            {formatWhen(d.decision.createdAt)}
          </span>
        </div>
        {d.decision.rationale ? (
          <p className="pt-3 text-meta leading-[18px] text-muted">
            <span className="font-semibold text-ink">Why: </span>
            {d.decision.rationale}
          </p>
        ) : null}
      </section>

      {d.verdict?.decision === 'DENY' && d.whyBlocked.length > 0 ? (
        <section aria-label="Why this was blocked" className="rounded-md bg-deny-tint p-4">
          <h2 className="text-small font-bold text-deny">Why was this blocked?</h2>
          <ul className="space-y-1 pt-2 text-meta leading-[18px] text-ink">
            {d.whyBlocked.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card label="What would change" right={<Tag tone="quiet">Simulated first</Tag>}>
        {d.simulation === null ? (
          <p className="text-meta text-muted">Nothing was simulated for this decision.</p>
        ) : d.simulation.ok ? (
          d.simulation.deltas.length === 0 ? (
            <p className="text-meta text-muted">The simulation passed with no balance changes.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.simulation.deltas.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2 first:pt-0">
                  <span className="text-meta text-muted capitalize">
                    {x.holder} · {x.token}
                  </span>
                  <span className="tabular text-small font-bold text-ink">{x.delta}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-meta text-deny">
            The simulation failed{d.simulation.error ? `: ${d.simulation.error}` : ''}. Nothing was
            sent.
          </p>
        )}
      </Card>

      <Card
        label="Deterministic policy checks"
        right={
          checks.length > 0 ? (
            <Tag tone={passed === checks.length ? 'soft' : 'warn'}>
              {passed} of {checks.length} passed
            </Tag>
          ) : null
        }
      >
        {d.verdict ? (
          <p className="pb-3 text-fine text-muted">
            Checked against policy v{d.verdict.policyVersion} at {formatWhen(d.verdict.evaluatedAt)}
            .
          </p>
        ) : null}
        <PolicyChecks checks={checks} />
      </Card>

      <section aria-label="Proof" className="rounded-md bg-surface-3/60 p-4">
        <div className="flex items-center justify-between gap-2 pb-3">
          <span className="label flex items-center gap-1.5">
            <IconFingerprint className="size-4" /> Proof
          </span>
          <Tag tone="quiet">Arc</Tag>
        </div>
        <p className="label pb-1">Transaction</p>
        {tx ? (
          <div className="flex items-center gap-1 rounded-sm bg-card p-2.5">
            <span className="min-w-0 flex-1 font-mono text-fine leading-5 break-all text-ink">
              {tx}
            </span>
            <CopyChip value={tx} label="transaction hash" />
          </div>
        ) : (
          <p className="rounded-sm bg-card p-2.5 text-meta text-muted">
            {d.execution?.error
              ? `Thesauros tried but did not send a transaction: ${d.execution.error}. Nothing moved.`
              : 'No transaction was sent. Nothing moved.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 pt-3">
          <div>
            <p className="label pb-1">Decision id</p>
            <p className="truncate font-mono text-fine text-ink">{d.decision.id}</p>
          </div>
          <div>
            <p className="label pb-1">Settled</p>
            <p className="text-fine text-ink">
              {d.execution?.confirmedAt ? formatWhen(d.execution.confirmedAt) : '—'}
            </p>
          </div>
        </div>
        {tx ? (
          <a
            href={`${explorerBase}/tx/${tx}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex min-h-11 items-center justify-center gap-1.5 rounded-sm bg-card text-meta font-bold text-ink shadow-e1 hover:bg-surface-2"
          >
            View on Arc explorer <IconExternal className="size-4" />
          </a>
        ) : null}
      </section>

      <div className="flex flex-col gap-2 pt-2">
        <Button loading={verify.busy} onClick={() => void verify.run()}>
          <IconShieldCheck className="size-5" /> Verify audit chain
        </Button>
        <AuditVerifyResult result={verify.result} />
        <Button
          variant="ghost"
          onClick={() =>
            downloadText(
              JSON.stringify(d, null, 2),
              `thesauros-decision-${d.decision.id}.json`,
              'application/json',
            )
          }
        >
          <IconDownload className="size-5" /> Download JSON receipt
        </Button>
      </div>
    </div>
  );
}

export function DecisionDetailScreen({ id }: { id: string }) {
  const q = useApi(`/api/decisions/${encodeURIComponent(id)}`, zDecisionDetail);
  const cfg = useApi('/api/config', zConfig);
  const explorerBase = cfg.data?.explorerBase ?? 'https://explorer.testnet.arc.io';
  if (q.data) return <DecisionDetailView detail={q.data} explorerBase={explorerBase} />;
  if (q.error)
    return (
      <div className="pt-4">
        <ErrorPanel
          title="Thesauros could not load this decision"
          body="Nothing moved. The decision is still in the log. Try again."
          onRetry={q.refetch}
        />
      </div>
    );
  return (
    <div className="flex flex-col gap-3 px-4 pt-3" aria-busy="true">
      <Skeleton className="h-7 w-40 rounded-full" />
      <Skeleton className="h-48 w-full rounded-md" />
      <Skeleton className="h-32 w-full rounded-md" />
    </div>
  );
}

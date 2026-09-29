'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { connectAddress, signMessage } from '@/lib/injectedWallet';
import { formatWhen, groupAddress, shortAddress, toBig } from '@/lib/format';
import { banners, pillState } from '@/lib/status';
import {
  AllowanceMeter,
  Banner,
  Button,
  Chip,
  Eyebrow,
  Money,
  Row,
  StatusPill,
  VerdictBadge,
  Wordmark,
  meterTone,
} from '@/components/primitives';
import { IconRecipients, IconRevoke, IconShield, IconVault, IconWallet } from '@/components/icons';

type Treasury = {
  wallet: {
    id: string;
    treasuryAddress: string;
    agentWalletAddress: string | null;
    frozen: boolean;
    frozenReason: string | null;
    breakerOpen: boolean;
    activePolicyVersion: number | null;
  };
  balances: { treasuryUsdc: string; agentUsdc: string } | null;
  vaultPositions: { id: string; name: string; assets: string; redeemableAssets: string }[];
  policyVersion: number | null;
  pendingApprovals: { id: string; message: string; expiresAt: string }[];
  deniedCount: number;
  workerHeartbeat: { event: string; createdAt: string } | null;
};

type Recipient = {
  id: string;
  label: string;
  address: string;
  maxPerTx: string;
  riskTier: 'low' | 'medium' | 'high';
};

type AuditEntry = {
  id: number;
  actor: string;
  event: string;
  entityType: string;
  createdAt: string;
};

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const WORKER_STALE_MS = 5 * 60 * 1000;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${path} failed (${res.status})`);
  return body as T;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-6 ${className}`}>
      {children}
    </section>
  );
}

const RISK_CHIP_TONE = { low: 'neutral', medium: 'warn', high: 'warn' } as const;

export default function Home() {
  const [address, setAddress] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [mandateText, setMandateText] = useState('');
  const [mandateOutcome, setMandateOutcome] = useState<{
    draft: unknown;
    sentences: string[];
    issues: { code: string; message: string }[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, r, a] = await Promise.all([
        api<Treasury>('/api/treasury'),
        api<{ recipients: Recipient[] }>('/api/policy/recipients'),
        api<{ entries: AuditEntry[] }>('/api/audit?limit=50'),
      ]);
      setTreasury(t);
      setRecipients(r.recipients);
      setAudit(a.entries);
      setError(null);
    } catch {
      setTreasury(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    fn()
      .then(() => refresh())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const connect = () =>
    run('connect', async () => {
      const addr = await connectAddress();
      const { message } = await api<{ message: string }>(`/api/auth/nonce?address=${addr}`);
      const signature = await signMessage(addr, message);
      await api('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ address: addr, message, signature }),
      });
      setAddress(addr);
    });

  const provisionWallet = () =>
    run('provision', () => api('/api/wallet/provision', { method: 'POST' }));

  const compileMandate = () =>
    run('mandate', async () => {
      const outcome = await api<typeof mandateOutcome>('/api/mandate', {
        method: 'POST',
        body: JSON.stringify({ text: mandateText, template: 'custom' }),
      });
      setMandateOutcome(outcome);
    });

  const activatePolicy = () =>
    run('activate', async () => {
      if (!address) return;
      const { message } = await api<{ message: string }>('/api/policy');
      const signature = await signMessage(address, message);
      await api('/api/policy', { method: 'POST', body: JSON.stringify({ signature, message }) });
      setMandateOutcome(null);
    });

  const decideApproval = (id: string, decision: 'approved' | 'rejected') =>
    run(`approval-${id}`, async () => {
      if (!address) return;
      const approval = treasury?.pendingApprovals.find((a) => a.id === id);
      if (!approval) return;
      const signature = await signMessage(address, approval.message);
      await api(`/api/approvals/${id}`, {
        method: 'POST',
        body: JSON.stringify({ decision, signature }),
      });
    });

  const ownerAction = (label: string, path: string, method: 'POST' | 'DELETE' = 'POST') =>
    run(label, async () => {
      if (!address) return;
      const { message } = await api<{ message: string }>(path, { method, body: '{}' });
      const signature = await signMessage(address, message);
      await api(path, { method, body: JSON.stringify({ signature, message }) });
    });

  const workerStale =
    treasury === null ||
    treasury.workerHeartbeat === null ||
    Date.now() - new Date(treasury.workerHeartbeat.createdAt).getTime() > WORKER_STALE_MS;

  const activeBanners = useMemo(
    () =>
      treasury
        ? banners({ demoMode: DEMO_MODE, wallet: treasury.wallet, workerStale })
        : DEMO_MODE
          ? banners({ demoMode: true, wallet: undefined, workerStale: false })
          : [],
    [treasury, workerStale],
  );

  if (!treasury) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-8 p-8 text-center"
      >
        {activeBanners.map((b) => (
          <Banner key={b.id} tone={b.tone} title={b.title} live={b.live}>
            {b.body}
          </Banner>
        ))}
        <div>
          <Wordmark className="text-h1" />
          <p className="mt-3 text-small text-muted">
            The treasury that reconciles itself before it pays.
          </p>
        </div>
        <Button onClick={connect} loading={busy === 'connect'} className="w-auto px-10">
          Connect wallet
        </Button>
        {error && <p className="text-small text-deny">{error}</p>}
      </main>
    );
  }

  const w = treasury.wallet;
  const status = pillState({
    wallet: w,
    pendingApprovals: treasury.pendingApprovals.length,
    workerStale,
  });

  return (
    <main id="main" className="mx-auto max-w-2xl pb-16">
      {activeBanners.map((b) => (
        <Banner key={b.id} tone={b.tone} title={b.title} live={b.live}>
          {b.body}
        </Banner>
      ))}
      <header className="flex items-center justify-between px-4 py-6">
        <Wordmark />
        <StatusPill state={status} />
      </header>
      {error && (
        <div className="mx-4 mb-4 rounded-md bg-deny-tint px-3 py-2 text-small text-deny">
          {error}
        </div>
      )}

      <div className="space-y-6 px-4">
        {/* ── Treasury ────────────────────────────────────────────────────────────────────── */}
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Eyebrow className="px-0 pt-0">Agent wallet balance</Eyebrow>
              <Money base={toBig(treasury.balances?.agentUsdc)} />
            </div>
            <IconWallet className="size-8 shrink-0 text-muted" />
          </div>
          <p className="mt-3 font-mono text-mono text-muted">{groupAddress(w.treasuryAddress)}</p>
          <p className="text-small text-muted">
            {w.agentWalletAddress
              ? shortAddress(w.agentWalletAddress)
              : 'agent wallet not provisioned yet'}
          </p>
          {!w.agentWalletAddress && (
            <Button
              onClick={provisionWallet}
              loading={busy === 'provision'}
              className="mt-4 w-auto px-6"
            >
              Provision Circle wallet
            </Button>
          )}
          {treasury.vaultPositions.length > 0 && (
            <div className="mt-4 divide-y divide-line border-t border-line">
              {treasury.vaultPositions.map((v) => (
                <Row
                  key={v.id}
                  icon={IconVault}
                  title={v.name}
                  sub={
                    <>
                      <Money base={toBig(v.redeemableAssets)} /> redeemable now
                    </>
                  }
                  right={<Money base={toBig(v.assets)} />}
                />
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="danger"
              onClick={() => ownerAction('freeze', '/api/freeze')}
              loading={busy === 'freeze'}
              className="w-auto px-5"
            >
              Freeze
            </Button>
            <Button
              variant="ghost"
              onClick={() => ownerAction('unfreeze', '/api/freeze', 'DELETE')}
              loading={busy === 'unfreeze'}
              className="w-auto px-5"
            >
              Unfreeze
            </Button>
            <Button
              variant="ghost"
              onClick={() => ownerAction('revoke', '/api/revoke')}
              loading={busy === 'revoke'}
              className="w-auto px-5"
            >
              <IconRevoke className="size-4" /> Revoke
            </Button>
            <Button
              variant="ghost"
              onClick={() => ownerAction('sweep', '/api/sweep')}
              loading={busy === 'sweep'}
              className="w-auto px-5"
            >
              Sweep home
            </Button>
          </div>
        </Card>

        {/* ── Mandate / policy ────────────────────────────────────────────────────────────── */}
        {treasury.policyVersion === null ? (
          <Card>
            <h2 className="text-h2 font-bold text-ink">Mandate</h2>
            <p className="mt-1 text-small text-muted">
              Write your mandate in plain English. Add recipients first if it names them.
            </p>
            <textarea
              value={mandateText}
              onChange={(e) => setMandateText(e.target.value)}
              rows={5}
              className="mt-4 w-full rounded-md border border-line-strong bg-ground p-3 text-small text-ink placeholder:text-faint focus-visible:outline-none"
              placeholder="Keep at least 3 months of runway in USDC; deposit the rest into the yield vault; pay Acme Studio $2,000 on the 1st of each month."
            />
            <Button
              onClick={compileMandate}
              disabled={!mandateText}
              loading={busy === 'mandate'}
              className="mt-4 w-auto px-6"
            >
              Compile policy
            </Button>
            {mandateOutcome && (
              <div className="mt-5 space-y-3">
                {mandateOutcome.sentences.map((s, i) => (
                  <p key={i} className="text-small text-ink">
                    {s}
                  </p>
                ))}
                {mandateOutcome.issues.length > 0 && (
                  <div className="space-y-2">
                    {mandateOutcome.issues.map((iss, i) => (
                      <Chip key={i} tone="warn">
                        {iss.code}: {iss.message}
                      </Chip>
                    ))}
                  </div>
                )}
                {mandateOutcome.draft !== null && mandateOutcome.issues.length === 0 && (
                  <Button
                    onClick={activatePolicy}
                    loading={busy === 'activate'}
                    className="w-auto px-6"
                  >
                    Sign &amp; activate policy
                  </Button>
                )}
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-h2 font-bold text-ink">Policy v{treasury.policyVersion}</h2>
              <IconShield className="size-6 text-muted" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <VerdictBadge tone="deny" label={`${treasury.deniedCount} denied`} />
            </div>
            <p className="mt-2 text-small text-muted">
              Worker last seen:{' '}
              {treasury.workerHeartbeat ? formatWhen(treasury.workerHeartbeat.createdAt) : 'never'}
            </p>
          </Card>
        )}

        {/* ── Approvals ───────────────────────────────────────────────────────────────────── */}
        <Card>
          <h2 className="text-h2 font-bold text-ink">Pending approvals</h2>
          {treasury.pendingApprovals.length === 0 ? (
            <p className="mt-2 text-small text-muted">None right now.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {treasury.pendingApprovals.map((a) => (
                <div key={a.id} className="rounded-md bg-surface-2 p-4">
                  <VerdictBadge tone="escalate" />
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-mono text-muted">
                    {a.message}
                  </pre>
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => decideApproval(a.id, 'approved')}
                      loading={busy === `approval-${a.id}` && busy !== null}
                      className="h-11 w-auto px-5 text-small"
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => decideApproval(a.id, 'rejected')}
                      className="h-11 w-auto px-5 text-small"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Compliance / recipients ─────────────────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center gap-2">
            <IconRecipients className="size-5 text-muted" />
            <h2 className="text-h2 font-bold text-ink">Recipients &amp; compliance</h2>
          </div>
          {recipients.length === 0 ? (
            <p className="mt-2 text-small text-muted">No recipients yet.</p>
          ) : (
            <div className="mt-3 divide-y divide-line">
              {recipients.map((r) => {
                const cap = toBig(r.maxPerTx);
                return (
                  <div key={r.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-h3 font-semibold text-ink">{r.label}</p>
                        <p className="truncate font-mono text-mono text-muted">
                          {shortAddress(r.address)}
                        </p>
                      </div>
                      <Chip tone={RISK_CHIP_TONE[r.riskTier]}>{r.riskTier} risk</Chip>
                    </div>
                    <div className="mt-2">
                      <AllowanceMeter
                        usedPct={0}
                        capPct={100}
                        tone={meterTone(0n, cap)}
                        caption={
                          <>
                            Cap <Money base={cap} /> per payment
                          </>
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              run('add-recipient', async () => {
                if (!address) return;
                const body = {
                  label: String(data.get('label')),
                  address: String(data.get('recipientAddress')),
                  maxPerTxUsdc: String(data.get('maxPerTxUsdc')),
                };
                const { message } = await api<{ message: string }>('/api/policy/recipients', {
                  method: 'POST',
                  body: JSON.stringify(body),
                });
                const signature = await signMessage(address, message);
                await api('/api/policy/recipients', {
                  method: 'POST',
                  body: JSON.stringify({ ...body, signature, message }),
                });
                form.reset();
              });
            }}
            className="mt-4 flex flex-wrap gap-2"
          >
            <input
              name="label"
              placeholder="Label"
              required
              className="min-h-11 rounded-full border border-line-strong bg-ground px-4 text-small text-ink placeholder:text-faint focus-visible:outline-none"
            />
            <input
              name="recipientAddress"
              placeholder="0x…"
              required
              className="min-h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-ground px-4 font-mono text-mono text-ink placeholder:text-faint focus-visible:outline-none"
            />
            <input
              name="maxPerTxUsdc"
              placeholder="Max per tx (USDC)"
              required
              className="min-h-11 w-44 rounded-full border border-line-strong bg-ground px-4 text-small text-ink placeholder:text-faint focus-visible:outline-none"
            />
            <Button
              type="submit"
              loading={busy === 'add-recipient'}
              className="h-11 w-auto px-6 text-small"
            >
              Add recipient
            </Button>
          </form>
        </Card>

        {/* ── Audit trail ─────────────────────────────────────────────────────────────────── */}
        <Card>
          <h2 className="text-h2 font-bold text-ink">Audit trail</h2>
          <div className="mt-2 max-h-72 divide-y divide-line overflow-y-auto">
            {audit.length === 0 && (
              <p className="py-3 text-small text-muted">Nothing recorded yet.</p>
            )}
            {audit.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-small text-ink">
                  <span className="text-muted">{row.actor}</span> · {row.event}
                </span>
                <span className="shrink-0 font-mono text-mono text-muted">
                  {formatWhen(row.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { connectAddress, signMessage } from '@/lib/injectedWallet';

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

// DEMO_MODE is read at build/runtime from the server; the client just gets told via /api/treasury's
// absence of an env leak — simplest is a static banner env var baked in at build time (I11: this UI
// never claims live data when the server is in demo mode).
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${path} failed (${res.status})`);
  return body as T;
}

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

  if (!treasury) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-3xl font-semibold">Thesauros</h1>
        <p className="mt-2 text-neutral-400">The treasury that reconciles itself before it pays.</p>
        {DEMO_MODE && (
          <div className="mt-4 rounded bg-amber-900/40 px-3 py-1 text-sm text-amber-300">
            DEMO DATA
          </div>
        )}
        <button
          onClick={connect}
          disabled={busy === 'connect'}
          className="mt-8 rounded bg-emerald-600 px-6 py-3 font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy === 'connect' ? 'Connecting…' : 'Connect wallet'}
        </button>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </main>
    );
  }

  const w = treasury.wallet;

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Thesauros</h1>
        {DEMO_MODE && (
          <span className="rounded bg-amber-900/40 px-3 py-1 text-sm text-amber-300">
            DEMO DATA
          </span>
        )}
      </header>
      {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <section className="rounded border border-neutral-800 p-4">
        <h2 className="font-medium">Treasury</h2>
        <p className="mt-1 text-sm text-neutral-400">Owner: {w.treasuryAddress}</p>
        <p className="text-sm text-neutral-400">
          Agent wallet: {w.agentWalletAddress ?? 'not provisioned'}
          {w.frozen && <span className="ml-2 text-red-400">FROZEN — {w.frozenReason}</span>}
        </p>
        {!w.agentWalletAddress && (
          <button
            onClick={provisionWallet}
            disabled={busy === 'provision'}
            className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === 'provision' ? 'Provisioning…' : 'Provision Circle wallet'}
          </button>
        )}
        {treasury.balances && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>Treasury USDC: {treasury.balances.treasuryUsdc}</div>
            <div>Agent USDC: {treasury.balances.agentUsdc}</div>
          </div>
        )}
        {treasury.vaultPositions.map((v) => (
          <div key={v.id} className="mt-1 text-sm text-neutral-400">
            {v.name}: {v.assets} USDC ({v.redeemableAssets} redeemable)
          </div>
        ))}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => ownerAction('freeze', '/api/freeze')}
            className="rounded bg-red-700 px-3 py-1.5 text-sm hover:bg-red-600"
          >
            Freeze
          </button>
          <button
            onClick={() => ownerAction('unfreeze', '/api/freeze', 'DELETE')}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600"
          >
            Unfreeze
          </button>
          <button
            onClick={() => ownerAction('revoke', '/api/revoke')}
            className="rounded bg-red-900 px-3 py-1.5 text-sm hover:bg-red-800"
          >
            Revoke
          </button>
          <button
            onClick={() => ownerAction('sweep', '/api/sweep')}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600"
          >
            Sweep home
          </button>
        </div>
      </section>

      {treasury.policyVersion === null ? (
        <section className="rounded border border-neutral-800 p-4">
          <h2 className="font-medium">Mandate</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Write your mandate in plain English. Add recipients/vaults first if it references them
            by name.
          </p>
          <textarea
            value={mandateText}
            onChange={(e) => setMandateText(e.target.value)}
            rows={5}
            className="mt-3 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm"
            placeholder="Keep at least 3 months of runway in USDC; deposit the rest into the yield vault; pay Acme Studio $2,000 on the 1st of each month."
          />
          <button
            onClick={compileMandate}
            disabled={busy === 'mandate' || !mandateText}
            className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === 'mandate' ? 'Compiling…' : 'Compile policy'}
          </button>
          {mandateOutcome && (
            <div className="mt-4 space-y-2 text-sm">
              {mandateOutcome.sentences.map((s, i) => (
                <p key={i} className="text-neutral-300">
                  {s}
                </p>
              ))}
              {mandateOutcome.issues.length > 0 && (
                <div className="rounded bg-amber-950 p-2 text-amber-300">
                  {mandateOutcome.issues.map((iss, i) => (
                    <p key={i}>
                      {iss.code}: {iss.message}
                    </p>
                  ))}
                </div>
              )}
              {mandateOutcome.draft !== null && mandateOutcome.issues.length === 0 && (
                <button
                  onClick={activatePolicy}
                  disabled={busy === 'activate'}
                  className="rounded bg-emerald-600 px-4 py-2 hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy === 'activate' ? 'Activating…' : 'Sign & activate policy'}
                </button>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="rounded border border-neutral-800 p-4">
          <h2 className="font-medium">Policy v{treasury.policyVersion}</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Denied proposals so far: {treasury.deniedCount}. Worker last seen:{' '}
            {treasury.workerHeartbeat?.createdAt ?? 'never'}.
          </p>
        </section>
      )}

      <section className="rounded border border-neutral-800 p-4">
        <h2 className="font-medium">Pending approvals</h2>
        {treasury.pendingApprovals.length === 0 && (
          <p className="mt-1 text-sm text-neutral-500">None.</p>
        )}
        {treasury.pendingApprovals.map((a) => (
          <div key={a.id} className="mt-2 rounded bg-neutral-900 p-2 text-sm">
            <pre className="whitespace-pre-wrap text-neutral-400">{a.message}</pre>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => decideApproval(a.id, 'approved')}
                className="rounded bg-emerald-600 px-3 py-1 hover:bg-emerald-500"
              >
                Approve
              </button>
              <button
                onClick={() => decideApproval(a.id, 'rejected')}
                className="rounded bg-red-700 px-3 py-1 hover:bg-red-600"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded border border-neutral-800 p-4">
        <h2 className="font-medium">Compliance — recipients</h2>
        {recipients.length === 0 && (
          <p className="mt-1 text-sm text-neutral-500">No recipients yet.</p>
        )}
        {recipients.map((r) => (
          <div key={r.id} className="mt-1 flex justify-between text-sm">
            <span>
              {r.label} ({r.address.slice(0, 8)}…) — max {r.maxPerTx} µUSD/tx
            </span>
            <span
              className={
                r.riskTier === 'high'
                  ? 'text-red-400'
                  : r.riskTier === 'medium'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }
            >
              {r.riskTier}
            </span>
          </div>
        ))}
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
          className="mt-3 flex flex-wrap gap-2 text-sm"
        >
          <input
            name="label"
            placeholder="Label"
            required
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
          <input
            name="recipientAddress"
            placeholder="0x…"
            required
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
          <input
            name="maxPerTxUsdc"
            placeholder="Max per tx (USDC)"
            required
            className="w-40 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          />
          <button
            type="submit"
            disabled={busy === 'add-recipient'}
            className="rounded bg-emerald-600 px-3 py-1 hover:bg-emerald-500 disabled:opacity-50"
          >
            Add recipient
          </button>
        </form>
      </section>

      <section className="rounded border border-neutral-800 p-4">
        <h2 className="font-medium">Audit trail</h2>
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
          {audit.map((row) => (
            <div key={row.id} className="flex justify-between border-b border-neutral-900 py-1">
              <span>
                {row.actor} · {row.event} · {row.entityType}
              </span>
              <span className="text-neutral-500">{new Date(row.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

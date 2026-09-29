'use client';
// The freeze flow. Three steps, in the order SECURITY practice fixes them:
//
//   1. Freeze now       — one owner signature. Thesauros stops proposing and stops executing.
//   2. Revoke Paymaster access — nothing to sign: Circle's Gas Station policy is console-configured
//      and account-wide, not a per-wallet on-chain grant (D-012/D-019 item 9), so there is no
//      separate revoke transaction. This step completes the instant step 1 does.
//   3. Bring funds home — sweepHome, the only action allowed while frozen. Runs synchronously in
//      the request (apps/web/lib/sweep.ts), so there is no polling loop here either.
//
// I7 — nothing on this path touches reasoning or the worker: step 1 is a DB write, step 3 runs the
// Policy Engine directly against the chain. Both work with everything else dead.
import { useState } from 'react';
import {
  BlockerPanel,
  LiteralPayload,
  SignErrorPanel,
  SignStatus,
} from '@/components/sign/SignSurface';
import { Button } from '@/components/primitives';
import { IconHomeward, IconLock, IconShieldCheck, VerdictGlyph } from '@/components/icons';
import { apiPost } from '@/lib/api';
import { zFreezePrepare, zFreezeResult, zSweepResult, type SweepResult } from '@/lib/contracts';
import { signErrorCopy, type SignError } from '@/lib/signCopy';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { signMessage } from '@/lib/injectedWallet';

export type FreezeFlowProps = { frozen: boolean; onDone: () => void; onClose: () => void };
export type StepState = 'todo' | 'active' | 'busy' | 'done' | 'failed';

export function FreezeFlow({ frozen, onDone, onClose }: FreezeFlowProps) {
  const { blocker, switchNetwork, switching } = useSigner(undefined);
  const [address, setAddress] = useState<string | null>(null);
  const [step1Done, setStep1Done] = useState(frozen);
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [sweepError, setSweepError] = useState<SignError | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);

  const freeze = useSignFlow<string>({
    prepare: async () => {
      const { message } = await apiPost('/api/freeze', zFreezePrepare, {});
      return message;
    },
    sign: async (message) => {
      const { connectAddress } = await import('@/lib/injectedWallet');
      const addr = address ?? (await connectAddress());
      setAddress(addr);
      return signMessage(addr, message);
    },
    submit: async (message, signature) => {
      await apiPost('/api/freeze', zFreezeResult, { signature, message });
      setStep1Done(true);
    },
  });

  const runSweep = async () => {
    setSweepError(null);
    setSweepBusy(true);
    try {
      const { message } = await apiPost('/api/sweep', zFreezePrepare, {});
      const addr = address ?? (await (await import('@/lib/injectedWallet')).connectAddress());
      setAddress(addr);
      const signature = await signMessage(addr, message);
      const result = await apiPost('/api/sweep', zSweepResult, { signature, message });
      setSweep(result);
    } catch (e) {
      setSweepError(signErrorCopy(e));
    } finally {
      setSweepBusy(false);
    }
  };

  const s1: StepState = step1Done ? 'done' : 'active';
  const s2: StepState = step1Done ? 'done' : 'todo';
  const s3: StepState = !step1Done
    ? 'todo'
    : sweep?.status === 'executed'
      ? 'done'
      : sweepBusy
        ? 'busy'
        : 'active';
  const allDone = s1 === 'done' && s2 === 'done' && s3 === 'done';

  return (
    <div data-slot="freeze-flow">
      {blocker !== null && blocker.kind !== 'disconnected' ? (
        <div className="pb-4">
          <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />
        </div>
      ) : null}

      <ol className="space-y-2">
        <Step n={1} state={s1} title="Freeze now">
          {s1 === 'done' ? (
            <p role="status" aria-live="assertive" className="text-meta text-muted">
              Thesauros is stopped. No further actions will be taken.
            </p>
          ) : (
            <>
              <p className="max-w-[46ch] text-meta leading-[18px] text-muted">
                Sign to stop Thesauros immediately. Any request waiting for your approval is
                cancelled.
              </p>
              {freeze.prepared !== null ? <LiteralPayload value={freeze.prepared} /> : null}
              <SignStatus phase={freeze.phase} />
              {freeze.error ? (
                <SignErrorPanel error={freeze.error} onRetry={freeze.prepare} />
              ) : null}
              <div className="pt-3">
                <Button
                  variant="danger"
                  loading={['preparing', 'awaiting-signature', 'submitting'].includes(freeze.phase)}
                  onClick={freeze.prepared === null ? freeze.prepare : freeze.confirm}
                  className="h-12 rounded-md text-meta tracking-[0.06em] uppercase"
                >
                  <IconLock className="size-4" />
                  {freeze.prepared === null ? 'Freeze immediately' : 'Sign & freeze in wallet'}
                </Button>
              </div>
            </>
          )}
        </Step>

        <Step n={2} state={s2} title="Revoke Paymaster access">
          {s2 === 'done' ? (
            <p role="status" className="text-meta leading-[18px] text-muted">
              Covered by step 1. Circle&apos;s Gas Station policy is account-wide, so the freeze
              flag itself is what stops every sponsored call from this treasury (D-012).
            </p>
          ) : (
            <p className="max-w-[46ch] text-meta leading-[18px] text-muted">
              Stops Paymaster-sponsored transactions for this treasury.
            </p>
          )}
        </Step>

        <Step n={3} state={s3} title="Bring funds home">
          {s3 === 'done' ? (
            <p role="status" className="text-meta text-muted">
              Everything is back in your treasury.
            </p>
          ) : (
            <>
              <p className="max-w-[46ch] text-meta leading-[18px] text-muted">
                Thesauros sends every dollar the agent wallet holds to your treasury address. This
                still goes through your policy checks.
              </p>
              {sweep?.status === 'denied' ? (
                <p className="pt-2 text-meta text-deny">{sweep.reasons.join(' ')}</p>
              ) : null}
              {sweep?.status === 'failed' ? (
                <p className="pt-2 text-meta text-deny">{sweep.reason}</p>
              ) : null}
              {sweepError ? (
                <SignErrorPanel error={sweepError} onRetry={() => void runSweep()} />
              ) : null}
              {s3 === 'active' || sweepBusy ? (
                <div className="pt-3">
                  <Button
                    variant="dark"
                    loading={sweepBusy}
                    onClick={() => void runSweep()}
                    className="h-12 rounded-md text-ui"
                  >
                    <IconHomeward className="size-4" />
                    {sweepError || sweep?.status !== 'executed' ? 'Bring funds home' : 'Try again'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Step>
      </ol>

      <p className="mt-3 flex items-center gap-2 rounded-md bg-allow-tint px-3 py-2.5 text-fine leading-4 font-semibold text-allow">
        <IconShieldCheck className="size-4 shrink-0" />
        Works even if the model, the reasoning API or the worker is down.
      </p>

      <div className="space-y-2 pt-3">
        {allDone ? (
          <Button onClick={onDone} className="h-12 rounded-md">
            Done
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose} className="h-12 rounded-md text-ui">
          {s1 === 'done' ? 'Close' : 'Cancel and return'}
        </Button>
        {s1 === 'done' && !allDone ? (
          <p className="text-center text-fine text-muted">
            You can close this and come back. Thesauros stays stopped.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const BADGE: Record<StepState, string> = {
  todo: 'Waiting',
  active: 'Ready to sign',
  busy: 'Working',
  done: 'Done',
  failed: 'Failed',
};

function Step({
  n,
  state,
  title,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  children: React.ReactNode;
}) {
  const live = state === 'active' || state === 'busy';
  const box = live
    ? 'bg-deny-tint/70 ring-1 ring-deny/25'
    : state === 'done'
      ? 'bg-allow-tint/60'
      : state === 'failed'
        ? 'bg-deny-tint'
        : 'bg-surface-2';
  return (
    <li data-state={state} className={`rounded-lg p-3.5 ${box}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-ui font-bold text-ink">
          {state === 'done' ? (
            <VerdictGlyph tone="allow" className="size-5 shrink-0 text-allow" />
          ) : state === 'failed' ? (
            <VerdictGlyph tone="deny" className="size-5 shrink-0 text-deny" />
          ) : (
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-cap font-bold ${
                live ? 'bg-deny-fill text-on-deny-fill' : 'bg-surface-3 text-muted'
              }`}
            >
              {n}
            </span>
          )}
          {title}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-micro font-bold tracking-[0.06em] uppercase ${
            live
              ? 'bg-card text-deny'
              : state === 'done'
                ? 'bg-card text-allow'
                : 'bg-surface-3 text-muted'
          }`}
        >
          {BADGE[state]}
        </span>
      </div>
      <div className="pt-1.5 pl-7">{children}</div>
    </li>
  );
}

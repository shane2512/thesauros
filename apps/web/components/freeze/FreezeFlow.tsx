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
import { VerdictGlyph } from '@/components/icons';
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

      <ol className="space-y-3">
        <Step n={1} state={s1} title="Freeze now">
          {s1 === 'done' ? (
            <p role="status" aria-live="assertive" className="text-small text-muted">
              Thesauros is stopped. No further actions will be taken.
            </p>
          ) : (
            <>
              <p className="max-w-[46ch] text-small text-muted">
                Sign to stop Thesauros immediately. Any request waiting for your approval is
                cancelled.
              </p>
              {freeze.prepared !== null ? <LiteralPayload value={freeze.prepared} /> : null}
              <SignStatus phase={freeze.phase} />
              {freeze.error ? (
                <SignErrorPanel error={freeze.error} onRetry={freeze.prepare} />
              ) : null}
              <div className="pt-4">
                <Button
                  variant="danger"
                  loading={['preparing', 'awaiting-signature', 'submitting'].includes(freeze.phase)}
                  onClick={freeze.prepared === null ? freeze.prepare : freeze.confirm}
                  className="w-auto px-6"
                >
                  {freeze.prepared === null ? 'Freeze now' : 'Sign in wallet'}
                </Button>
              </div>
            </>
          )}
        </Step>

        <Step n={2} state={s2} title="Revoke Paymaster access">
          {s2 === 'done' ? (
            <p role="status" className="text-small text-muted">
              Circle's Gas Station policy is account-wide, not per-treasury — there is nothing
              further to revoke here (D-012). This step tracks the same freeze flag as step 1.
            </p>
          ) : (
            <p className="max-w-[46ch] text-small text-muted">Waiting on step 1.</p>
          )}
        </Step>

        <Step n={3} state={s3} title="Bring funds home">
          {s3 === 'done' ? (
            <p role="status" className="text-small text-muted">
              Everything is back in your treasury.
            </p>
          ) : (
            <>
              <p className="max-w-[46ch] text-small text-muted">
                Thesauros sends every dollar the agent wallet holds to your treasury address. This
                still goes through your policy checks.
              </p>
              {sweep?.status === 'denied' ? (
                <p className="pt-2 text-small text-deny">{sweep.reasons.join(' ')}</p>
              ) : null}
              {sweep?.status === 'failed' ? (
                <p className="pt-2 text-small text-deny">{sweep.reason}</p>
              ) : null}
              {sweepError ? (
                <SignErrorPanel error={sweepError} onRetry={() => void runSweep()} />
              ) : null}
              {s3 === 'active' || sweepBusy ? (
                <div className="pt-4">
                  <Button
                    loading={sweepBusy}
                    onClick={() => void runSweep()}
                    className="w-auto px-6"
                  >
                    {sweepError || sweep?.status !== 'executed' ? 'Bring funds home' : 'Try again'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Step>
      </ol>

      <div className="space-y-2 pt-6">
        {allDone ? (
          <Button onClick={onDone} className="w-auto px-6">
            Done
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose} className="w-auto px-6">
          {s1 === 'done' ? 'Close' : 'Cancel'}
        </Button>
        {s1 === 'done' && !allDone ? (
          <p className="text-small text-muted">
            You can close this and come back. Thesauros stays stopped.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const TONE: Record<StepState, string> = {
  todo: 'text-faint',
  active: 'text-ink',
  busy: 'text-ink',
  done: 'text-allow',
  failed: 'text-deny',
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
  return (
    <li data-state={state} className="rounded-md bg-surface-2 p-4">
      <p className={`flex items-center gap-2 text-h3 font-semibold ${TONE[state]}`}>
        {state === 'done' ? (
          <VerdictGlyph tone="allow" className="size-4 shrink-0" />
        ) : state === 'failed' ? (
          <VerdictGlyph tone="deny" className="size-4 shrink-0" />
        ) : (
          <span className="font-mono text-mono text-faint">{n}</span>
        )}
        {title}
      </p>
      <div className="pt-2">{children}</div>
    </li>
  );
}

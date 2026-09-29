'use client';
// Policy signing and activation — onboarding's final step. The sentences shown here are rendered by
// the server FROM THE BODY THAT WILL BE STORED, not from the draft the owner compiled earlier, so
// "what I read" and "what the engine will run" are the same object. The message is
// `Thesauros policy v{n} {hash}`, fetched, never composed.
import { useState } from 'react';
import { Button, TextButton } from '@/components/primitives';
import { apiPost } from '@/lib/api';
import { zPolicyActivated, zPolicyPrepare, type PolicyPrepare } from '@/lib/contracts';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { connectAddress, signMessage } from '@/lib/injectedWallet';
import { BlockerPanel, LiteralPayload, SignErrorPanel, SignStatus } from './SignSurface';

export function PolicySign({
  onActivated,
  cta = 'Sign and activate',
}: {
  onActivated: () => void;
  cta?: string;
}) {
  const { blocker, switchNetwork, switching } = useSigner(undefined);
  const [address, setAddress] = useState<string | null>(null);

  const flow = useSignFlow<PolicyPrepare>({
    prepare: () => apiPost('/api/policy', zPolicyPrepare),
    sign: async (p) => {
      const addr = address ?? (await connectAddress());
      setAddress(addr);
      return signMessage(addr, p.message);
    },
    submit: (p, signature) =>
      apiPost('/api/policy', zPolicyActivated, { signature, message: p.message }).then(
        () => undefined,
      ),
    onDone: onActivated,
  });

  if (blocker !== null && blocker.kind !== 'disconnected') {
    return <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />;
  }

  const p = flow.prepared;

  return (
    <div data-testid="policy-sign">
      {p === null ? (
        <p className="max-w-[52ch] text-small text-muted">
          Thesauros will show you the exact rules and the exact words your wallet will sign. Signing
          moves no money; it decides what Thesauros is allowed to do.
        </p>
      ) : (
        <>
          <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
            Policy v{p.version}
          </p>
          <ol className="mt-2 space-y-2 rounded-md bg-surface-2 p-4" data-testid="policy-sentences">
            {p.sentences.map((s, i) => (
              <li key={s} className="flex gap-3 text-small text-ink">
                <span className="shrink-0 font-mono text-mono text-faint">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <LiteralPayload value={p.message} />
        </>
      )}

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.prepare} /> : null}

      <div className="pt-6">
        {p === null ? (
          <Button loading={flow.phase === 'preparing'} onClick={flow.prepare}>
            Review your policy
          </Button>
        ) : (
          <>
            <Button
              loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
              onClick={flow.confirm}
            >
              {cta}
            </Button>
            <div className="pt-2 text-center">
              <TextButton onClick={flow.reset}>Not yet</TextButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

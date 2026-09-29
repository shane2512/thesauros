'use client';
// Unfreeze. Deliberately NOT in the freeze modal, since starting again is a different decision from
// stopping and should not sit one click away from it.
import {
  BlockerPanel,
  LiteralPayload,
  SignErrorPanel,
  SignStatus,
} from '@/components/sign/SignSurface';
import { Button } from '@/components/primitives';
import { apiDelete, apiPost } from '@/lib/api';
import { zFreezePrepare, zUnfreezeResult } from '@/lib/contracts';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { connectAddress, signMessage } from '@/lib/injectedWallet';

export function UnfreezeSlot({ frozen, onUnfrozen }: { frozen: boolean; onUnfrozen: () => void }) {
  const { blocker, switchNetwork, switching } = useSigner(undefined);
  const flow = useSignFlow<string>({
    prepare: async () => (await apiPost('/api/freeze', zFreezePrepare, {})).message,
    sign: async (message) => signMessage(await connectAddress(), message),
    submit: (message, signature) =>
      apiDelete('/api/freeze', zUnfreezeResult, { signature, message }).then(() => undefined),
    onDone: onUnfrozen,
  });

  if (!frozen) return null;
  return (
    <div data-slot="unfreeze" className="rounded-md bg-surface-2 p-4">
      <p className="text-h3 font-semibold text-ink">Thesauros is stopped</p>
      <p className="max-w-[46ch] pt-2 text-small text-muted">
        Unfreezing lets Thesauros propose and act again, and clears the safety breaker.
      </p>

      {flow.prepared !== null ? <LiteralPayload value={flow.prepared} /> : null}
      {blocker !== null && blocker.kind !== 'disconnected' ? (
        <div className="pt-4">
          <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />
        </div>
      ) : null}
      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.prepare} /> : null}

      <div className="pt-4">
        <Button
          variant="ghost"
          loading={['preparing', 'awaiting-signature', 'submitting'].includes(flow.phase)}
          onClick={flow.prepared === null ? flow.prepare : flow.confirm}
          className="w-auto px-6"
        >
          {flow.prepared === null ? 'Unfreeze' : 'Sign in wallet'}
        </Button>
      </div>
    </div>
  );
}

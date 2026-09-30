'use client';
// Add a vault (D-024). The owner never picks "kind" — the server recognizes Circle's real USYC
// Teller by address (docs/VERIFY.md row 15) and treats anything else as a plain ERC-4626 vault, so
// the confirmation screen shows what the server decided rather than asking the owner a question they
// have no way to answer correctly. Mirrors AddRecipientSign's two-step nonce+signature shape.
import { useState } from 'react';
import { Button, TextButton } from '@/components/primitives';
import { apiPost } from '@/lib/api';
import { zVaultAdded, type Vault } from '@/lib/contracts';
import { z } from 'zod';
import { groupAddress } from '@/lib/format';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { connectAddress, signMessage } from '@/lib/injectedWallet';
import { BlockerPanel, FactRow, LiteralPayload, SignErrorPanel, SignStatus } from './SignSurface';

const FIELD =
  'mt-2 h-14 w-full rounded-md bg-surface-2 px-4 text-h3 text-ink placeholder:text-faint';

const zPrepare = z.object({ message: z.string(), expiresAt: z.string() });
type Prepare = z.infer<typeof zPrepare>;

export function AddVaultSign({ onAdded }: { onAdded: (v: Vault) => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [pct, setPct] = useState('');
  const { blocker, switchNetwork, switching } = useSigner(undefined);
  const [signerAddress, setSignerAddress] = useState<string | null>(null);

  const pctNumber = Number(pct);
  const addressLooksValid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const pctOk =
    pct.trim() !== '' && Number.isFinite(pctNumber) && pctNumber >= 0 && pctNumber <= 100;
  const complete = name.trim() !== '' && addressLooksValid && pctOk;

  const fields = () => ({
    name: name.trim(),
    address: address.trim(),
    maxAllocationPct: pctNumber,
  });

  const flow = useSignFlow<Prepare>({
    prepare: () => apiPost('/api/policy/vaults', zPrepare, fields()),
    sign: async (p) => {
      const addr = signerAddress ?? (await connectAddress());
      setSignerAddress(addr);
      return signMessage(addr, p.message);
    },
    submit: (p, signature) =>
      apiPost('/api/policy/vaults', zVaultAdded, {
        ...fields(),
        signature,
        message: p.message,
      }).then((r) => onAdded(r.vault)),
  });

  if (blocker !== null && blocker.kind !== 'disconnected')
    return <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />;

  const p = flow.prepared;

  return (
    <div data-testid="add-vault-sign">
      {p === null ? (
        <>
          <label htmlFor="v-name" className="block text-small font-semibold text-ink">
            Name
          </label>
          <input
            id="v-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="USYC"
            className={FIELD}
          />

          <label htmlFor="v-address" className="block pt-5 text-small font-semibold text-ink">
            Vault address
          </label>
          <input
            id="v-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="0x…"
            className={`${FIELD} font-mono text-mono`}
          />
          <p className="pt-2 text-small text-muted">
            For a real yield vault, this is Circle&apos;s USYC Teller contract on Arc — Thesauros
            recognizes it automatically. Any other address is treated as a plain ERC-4626 vault.
          </p>
          {address.trim() !== '' && !addressLooksValid ? (
            <p role="alert" className="pt-1 text-small text-deny">
              That is not an Ethereum address. Nothing was saved.
            </p>
          ) : null}

          <label htmlFor="v-pct" className="block pt-5 text-small font-semibold text-ink">
            Most Thesauros may hold here
          </label>
          <input
            id="v-pct"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            inputMode="decimal"
            placeholder="50"
            className={`${FIELD} tabular`}
          />
          <p className="pt-2 text-small text-muted">Percent of everything Thesauros manages.</p>
          {pct.trim() !== '' && !pctOk ? (
            <p role="alert" className="pt-1 text-small text-deny">
              Enter a percentage from 0 to 100.
            </p>
          ) : null}
        </>
      ) : (
        <div data-testid="vault-confirm">
          <div className="rounded-md bg-surface-2 px-4 py-2">
            <FactRow label="Name">{name.trim()}</FactRow>
            <FactRow label="Most Thesauros may hold here">{pctNumber}%</FactRow>
          </div>
          <div className="mt-4 rounded-md bg-surface-2 p-4">
            <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
              Address
            </p>
            <p className="pt-2 font-mono text-mono break-all text-ink">
              {groupAddress(address.trim())}
            </p>
          </div>
          <LiteralPayload value={p.message} />
        </div>
      )}

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.reset} /> : null}

      <div className="pt-6">
        {p === null ? (
          <Button disabled={!complete} loading={flow.phase === 'preparing'} onClick={flow.prepare}>
            Check this vault
          </Button>
        ) : (
          <>
            <Button
              loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
              onClick={flow.confirm}
            >
              Sign and add vault
            </Button>
            <div className="pt-2 text-center">
              <TextButton onClick={flow.reset}>Go back and edit</TextButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

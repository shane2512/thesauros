'use client';
// Vaults (D-024). Where Thesauros keeps idle USDC productive. Adding a vault is inert until the
// owner also signs the next policy version (the active policy's vaults array is frozen at signing
// time), so a successful add always routes into PolicySign next — same pattern as Recipients.
import { useState } from 'react';
import { AddVaultSign } from '@/components/sign/AddVaultSign';
import { PolicySign } from '@/components/sign/PolicySign';
import { IconVault } from '@/components/icons';
import {
  Banner,
  Button,
  EmptyState,
  ErrorPanel,
  PageHeading,
  RowSkeleton,
  Tag,
  TextButton,
} from '@/components/primitives';
import { zVaultList, type Vault } from '@/lib/contracts';
import { shortAddress } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Mode = 'list' | 'add' | 'sign-policy';

export function VaultsScreen() {
  const [mode, setMode] = useState<Mode>('list');
  const q = useApi('/api/policy/vaults', zVaultList);
  const vaults = q.data?.vaults ?? [];

  if (mode === 'add')
    return (
      <div className="px-4 pt-2">
        <TextButton className="-ml-3" onClick={() => setMode('list')}>
          ← Back to vaults
        </TextButton>
        <div className="card mt-2 p-4">
          <AddVaultSign
            onAdded={() => {
              q.refetch();
              setMode('sign-policy');
            }}
          />
        </div>
      </div>
    );

  if (mode === 'sign-policy')
    return (
      <div className="px-4 pt-4">
        <Banner tone="info" title="One more step">
          This vault isn&apos;t in effect yet. Sign the next policy version so Thesauros can use it.
        </Banner>
        <div className="pt-4">
          <PolicySign cta="Sign and activate" onActivated={() => setMode('list')} />
        </div>
        <div className="pt-3">
          <TextButton onClick={() => setMode('list')}>I&apos;ll sign later</TextButton>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <PageHeading sub="Where Thesauros keeps idle USDC productive, within the share of funds you allow.">
        Vaults
      </PageHeading>
      <div aria-live="polite">
        {q.isLoading ? (
          <div className="card">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : q.error ? (
          <ErrorPanel
            title="Thesauros could not load your vaults"
            body="Nothing changed. Check your connection and try again."
            onRetry={q.refetch}
          />
        ) : vaults.length === 0 ? (
          <EmptyState
            title="No vaults yet"
            body="Add a vault Thesauros may deposit idle USDC into, up to a share you set."
          />
        ) : (
          <ul data-testid="vaults-list" className="flex flex-col gap-2">
            {vaults.map((v: Vault) => (
              <li key={v.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-3 text-ink">
                    <IconVault className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-title font-semibold text-ink">{v.name}</span>
                      <div className="flex shrink-0 gap-1.5">
                        {v.flagged ? <Tag tone="deny">flagged</Tag> : null}
                        {v.kind === 'usyc_teller' ? (
                          <Tag tone="accent">USYC</Tag>
                        ) : (
                          <Tag tone="quiet">ERC-4626</Tag>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 font-mono text-fine text-muted">{shortAddress(v.address)}</p>
                    <p className="pt-1.5 text-meta text-muted">
                      Up to{' '}
                      <strong className="font-semibold text-ink">
                        {(v.maxAllocationBps / 100).toFixed(2)}%
                      </strong>{' '}
                      of everything Thesauros manages
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button onClick={() => setMode('add')}>Add vault</Button>
    </div>
  );
}

'use client';
// Policy signing and activation — onboarding's final step. The sentences shown here are rendered by
// the server FROM THE BODY THAT WILL BE STORED, not from the draft the owner compiled earlier, so
// "what I read" and "what the engine will run" are the same object. The message is
// `Thesauros policy v{n} {hash}`, fetched, never composed.
import { useEffect, useRef, useState } from 'react';
import {
  IconCheck,
  IconCopy,
  IconFingerprint,
  IconShield,
  IconShieldCheck,
  IconSign,
} from '@/components/icons';
import { Button, Skeleton, StickyCta, Tag } from '@/components/primitives';
import { apiGet, apiPost } from '@/lib/api';
import { zMe, zPolicyActivated, zPolicyPrepare, type PolicyPrepare } from '@/lib/contracts';
import { shortAddress } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { connectAddress, signMessage } from '@/lib/injectedWallet';
import { BlockerPanel, SignErrorPanel, SignStatus } from './SignSurface';

export function PolicySign({
  onActivated,
  onEdit,
  cta = 'Sign & activate treasury',
}: {
  onActivated: () => void;
  /** Back to the mandate editor; without it the secondary action just discards the review. */
  onEdit?: () => void;
  cta?: string;
}) {
  const { blocker, switchNetwork, switching } = useSigner(undefined);
  const me = useApi('/api/me', zMe);
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const flow = useSignFlow<PolicyPrepare>({
    prepare: () => apiGet('/api/policy/prepare', zPolicyPrepare),
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

  // Fetch what will be signed as soon as the review opens: a read, it moves nothing.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    flow.prepare();
  });

  if (blocker !== null && blocker.kind !== 'disconnected') {
    return <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />;
  }

  const p = flow.prepared;
  const signer = address ?? me.data?.user.address ?? null;
  const copyHash = async () => {
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p.bodyHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the hash is on screen and selectable */
    }
  };

  return (
    <div data-testid="policy-sign" className="flex flex-col gap-3">
      <div className="card flex items-center justify-between gap-2 p-3">
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-sm bg-surface-3 text-ink">
            <IconShieldCheck className="size-[18px]" />
          </span>
          <span>
            <span className="block text-ui leading-tight font-semibold text-ink">
              {p ? `Policy v${p.version}` : 'Policy Engine'}
            </span>
            <span className="block text-cap text-muted">
              Checked by plain code on every single move
            </span>
          </span>
        </span>
        {p ? (
          <Tag tone="soft" dot="ink">
            {p.sentences.length} rules
          </Tag>
        ) : null}
      </div>

      <section aria-label="Rules you are signing">
        <p className="label px-0.5 pb-2">Active directives{p ? ` (${p.sentences.length})` : ''}</p>
        <div className="card overflow-hidden">
          {p === null ? (
            flow.phase === 'preparing' ? (
              <div className="space-y-3 p-4" aria-busy="true">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : (
              <p className="p-4 text-ui leading-5 text-muted">
                Thesauros will show you the exact rules and the exact words your wallet will sign.
                Signing moves no money; it decides what Thesauros is allowed to do.
              </p>
            )
          ) : (
            <ol data-testid="policy-sentences" className="divide-y divide-line">
              {p.sentences.map((s, i) => (
                <li key={s} className="flex items-start gap-3 p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-3 font-display text-ui font-bold text-ink">
                    {i + 1}
                  </span>
                  <span className="pt-1 text-ui leading-5 text-ink">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {p ? (
        <section aria-label="What your wallet signs" className="rounded-md bg-surface-3/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="label flex items-center gap-1.5">
              <IconFingerprint className="size-4" /> Policy hash
            </span>
            <button
              type="button"
              onClick={() => void copyHash()}
              className="inline-flex min-h-9 items-center gap-1 rounded-sm bg-card px-2.5 text-cap font-bold text-ink shadow-e1 active:scale-95"
            >
              {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 rounded-sm bg-card p-2.5 font-mono text-fine leading-5 break-all text-ink select-all">
            {p.bodyHash}
          </p>
          <p className="label pt-3 pb-1.5">You will sign</p>
          <pre
            data-testid="literal-payload"
            tabIndex={0}
            className="overflow-auto rounded-sm bg-card p-2.5 font-mono text-fine leading-5 break-words whitespace-pre-wrap text-ink"
          >
            {p.message}
          </pre>
          <p className="flex items-start gap-2 pt-3 text-meta leading-[18px] text-muted">
            <IconShield className="mt-0.5 size-4 shrink-0" />
            <span>
              Signing sets the only rules Thesauros may act under.{' '}
              <strong className="font-semibold text-ink">No money moves</strong> when you sign.
            </span>
          </p>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="card p-4">
          <span className="label">Signing wallet</span>
          <span className="block truncate pt-1 font-mono text-ui font-semibold text-ink">
            {signer ? shortAddress(signer) : '—'}
          </span>
          <span className="block pt-1 text-cap font-semibold text-muted">Owner, only signer</span>
        </div>
        <div className="card p-4">
          <span className="label">Takes effect</span>
          <span className="block pt-1 text-title font-semibold text-ink">Immediately</span>
          <span className="block pt-1 text-cap text-muted">Replaces any older version</span>
        </div>
      </div>

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.prepare} /> : null}

      <StickyCta>
        {p === null ? (
          <Button loading={flow.phase === 'preparing'} onClick={flow.prepare}>
            Review your policy
          </Button>
        ) : (
          <Button
            loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
            onClick={flow.confirm}
          >
            <IconSign className="size-5" />
            {cta}
          </Button>
        )}
        <Button variant="quiet" className="h-10 text-meta" onClick={onEdit ?? flow.reset}>
          {onEdit ? 'Edit rules & limits' : 'Not yet'}
        </Button>
      </StickyCta>
    </div>
  );
}

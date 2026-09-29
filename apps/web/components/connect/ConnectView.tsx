'use client';
// Connect screen. Presentational: state is passed in, so every state can be rendered without a
// wallet. Adapted from Steward's own S2 screen — same markup/classes, a single injected-wallet
// connector instead of wagmi's multi-connector picker (D-017: one connect path needs no chooser).
import Link from 'next/link';
import { IconClose, IconLock, IconShield, VerdictGlyph } from '@/components/icons';
import { Button, Chip, Row, Wordmark } from '@/components/primitives';

export type ConnectStep =
  'idle' | 'connecting' | 'signing' | 'verifying' | 'signed_in' | 'rejected' | 'error';

const BUSY = new Set<ConnectStep>(['connecting', 'signing', 'verifying', 'signed_in']);
const COPY: Partial<Record<ConnectStep, { title: string; body: string }>> = {
  rejected: {
    title: 'Request not approved',
    body: 'You closed a wallet request (a network switch or a signature). Nothing was signed. You can try again when you are ready.',
  },
  error: {
    title: 'Could not connect',
    body: 'Thesauros could not complete the connection. Nothing moved. Try again.',
  },
};

export function ConnectView({ step, onConnect }: { step: ConnectStep; onConnect: () => void }) {
  const copy = COPY[step];
  const busy = BUSY.has(step);
  const bad = step === 'error';
  const retryable = step === 'rejected' || step === 'error';

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <header className="flex h-16 items-center justify-between px-4">
        <Wordmark />
        <Link
          href="/"
          aria-label="Close"
          className="-mr-2 flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-3"
        >
          <IconClose className="size-6" />
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 px-4 pt-4 outline-none">
        <img
          src="/logo/thesauros-logo.svg"
          alt=""
          width={64}
          height={64}
          className="mx-auto size-16"
        />
        <h1 className="pt-5 text-center font-display text-headline leading-8 font-bold tracking-[-0.02em] text-ink">
          Connect your wallet
        </h1>
        <p className="mx-auto max-w-[46ch] pt-2 text-center text-ui leading-5 text-muted">
          Thesauros never holds your keys. Every owner action is a signature you approve, and you
          can freeze, revoke or sweep the treasury home at any time.
        </p>

        <div className="card mt-6 divide-y divide-line overflow-hidden">
          <Row icon={IconShield} title="Arc testnet only" right={<Chip>Testnet</Chip>} />
          <Row icon={IconLock} title="Read-only until you sign" sub="Signing in moves no funds" />
        </div>

        <div aria-live="polite" className="pt-4">
          {copy ? (
            <div
              role={bad ? 'alert' : 'status'}
              className={`rounded-md p-4 ${bad ? 'bg-deny-tint' : 'bg-card shadow-e1'}`}
              data-state={step}
            >
              <p
                className={`flex items-center gap-2 text-h3 font-semibold ${bad ? 'text-deny' : 'text-ink'}`}
              >
                {bad ? <VerdictGlyph tone="deny" className="size-4 shrink-0" /> : null}
                {copy.title}
              </p>
              <p className="max-w-[46ch] pt-2 text-small text-muted">{copy.body}</p>
            </div>
          ) : null}
        </div>
      </main>

      <footer className="px-4 pt-6 pb-6">
        {retryable ? (
          <Button onClick={onConnect} loading={busy} className="w-full">
            Try again
          </Button>
        ) : (
          <Button onClick={onConnect} loading={busy} className="w-full">
            {busy ? 'Connecting' : 'Connect wallet'}
          </Button>
        )}
        <p className="pt-3 text-center text-small text-faint">
          By connecting you agree to the Terms.
        </p>
      </footer>
    </div>
  );
}

'use client';
// Onboarding steps 1-3. Step 4 is the policy-signing step: see PolicySign.tsx.
import { useState } from 'react';
import { IconLock, IconShield, IconVault } from '@/components/icons';
import { Button, ErrorPanel, Row, VerdictBadge } from '@/components/primitives';
import { CopyAddress } from '@/components/ui/CopyAddress';
import { ApiError, apiPost } from '@/lib/api';
import { zCompile, zProvision, type CompileResponse, type OnboardingState } from '@/lib/contracts';
import { isExampleText, TEMPLATE_CHIPS, type TemplateValue } from '@/lib/mandateExamples';

export function StepHeading({ children, sub }: { children: string; sub?: string }) {
  return (
    <>
      <h1 className="text-h1 font-bold tracking-[-0.015em] text-ink">{children}</h1>
      {sub ? <p className="max-w-[46ch] pt-3 text-body text-muted">{sub}</p> : null}
    </>
  );
}

/* ------------------------------------------------------------- 1 meet Thesauros */

export function MeetStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <StepHeading sub="Three things keep your money safe. You can stop everything, any time.">
        Meet Thesauros
      </StepHeading>
      <div className="-mx-4 pt-6">
        <Row
          icon={IconVault}
          title="Reasoning proposes"
          sub="Thesauros suggests moves. It never holds your keys and cannot send anything itself."
        />
        <Row
          icon={IconShield}
          title="Code disposes"
          sub="Every move is checked against your rules by plain code. One failed rule and nothing happens."
        />
        <Row
          icon={IconLock}
          title="You can freeze anytime"
          sub="The Freeze button is on every screen. It works even if Thesauros is down."
        />
      </div>
      <div className="pt-8">
        <Button onClick={onNext}>Continue</Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------- 2 create agent wallet */

export function provisionErrorCopy(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Your session ended. Sign in again. Nothing was created.';
    if (e.status === 409) return 'This treasury already has an agent wallet. Reload to see it.';
    if (e.code === 'network')
      return 'Thesauros could not reach the server. Nothing was created. Try again.';
  }
  return 'Thesauros could not create the wallet. Nothing moved and no funds were used. Try again.';
}

export function WalletStep({
  address,
  onNext,
  onCreated,
}: {
  address: string | null;
  onNext: () => void;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/wallet/provision', zProvision);
      onCreated();
    } catch (e) {
      setError(provisionErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <StepHeading sub="This is the address Thesauros acts from. It is separate from your own wallet.">
        Create your agent wallet
      </StepHeading>
      <div className="pt-6">
        {address ? (
          <CopyAddress address={address} />
        ) : (
          <div className="rounded-md bg-surface-2 p-4 text-small text-muted">
            Not created yet. Creating it costs nothing and moves no funds.
          </div>
        )}
        <p className="flex items-start gap-2 pt-3 text-small text-muted">
          <IconLock className="mt-0.5 size-4 shrink-0" />
          This wallet only ever holds what you allow.
        </p>
      </div>
      {error ? (
        <div className="-mx-4 pt-4" aria-live="polite">
          <ErrorPanel title="Wallet not created" body={error} />
        </div>
      ) : null}
      <div className="pt-8">
        {address ? (
          <Button onClick={onNext}>Continue</Button>
        ) : (
          <Button onClick={() => void create()} loading={busy}>
            {busy ? 'Creating' : 'Create agent wallet'}
          </Button>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------ 3 write mandate */

export function compileErrorCopy(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Your session ended. Sign in again. Nothing was saved.';
    if (e.status === 400) return 'Write your mandate in 1 to 4000 characters, then compile again.';
    if (e.status === 503) return 'Reasoning is not configured yet. Nothing was saved.';
    if (e.code === 'network')
      return 'Thesauros could not reach the server. Nothing was saved. Try again.';
  }
  return 'Thesauros could not compile the mandate. Nothing moved. Edit it or try again.';
}

export function MandateStep({
  saved,
  onCompiled,
  onNext,
}: {
  saved: OnboardingState['mandate'];
  onCompiled: () => void;
  onNext: () => void;
}) {
  const [template, setTemplate] = useState<TemplateValue>('startup');
  const [text, setText] = useState(saved?.text ?? TEMPLATE_CHIPS[0].text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompileResponse | null>(
    saved?.compiled
      ? {
          compiled: true,
          sentences: [],
          issues: [],
          assumptions: saved.assumptions,
          questions: saved.questions,
          mandateId: saved.id,
        }
      : null,
  );

  const pick = (v: TemplateValue, example: string) => {
    setTemplate(v);
    if (text.trim() === '' || isExampleText(text)) setText(example);
    setResult(null);
  };

  const compile = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost('/api/mandate', zCompile, { text: text.trim(), template });
      setResult(r);
      if (r.compiled) onCompiled();
    } catch (e) {
      setError(compileErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };

  const empty = text.trim().length === 0;

  return (
    <>
      <StepHeading>What should Thesauros do with idle USDC?</StepHeading>

      <div role="group" aria-label="Start from a template" className="flex flex-wrap gap-2 pt-5">
        {TEMPLATE_CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={template === c.value}
            onClick={() => pick(c.value, c.text)}
            className={`min-h-11 rounded-full px-4 text-small font-semibold ${
              template === c.value
                ? 'bg-surface-3 text-ink ring-1 ring-line-strong'
                : 'bg-surface-2 text-muted hover:text-ink'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <label className="block pt-4">
        <span className="block pb-2 text-small font-medium text-ink">Your mandate</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (template !== 'custom' && !isExampleText(e.target.value)) setTemplate('custom');
            setResult(null);
          }}
          maxLength={4000}
          rows={6}
          className="w-full rounded-md border border-line bg-surface-2 p-4 font-mono text-mono leading-relaxed text-ink placeholder:text-faint"
          placeholder="Keep 20,000 USDC liquid. Put the rest in the approved vault. Pay the contractors every Friday."
        />
      </label>
      <p className="max-w-[46ch] pt-2 text-small text-muted">
        Plain English. Thesauros compiles it into a policy you approve next.
      </p>

      {error ? (
        <div className="-mx-4 pt-4" aria-live="polite">
          <ErrorPanel title="Not compiled" body={error} />
        </div>
      ) : null}

      <div aria-live="polite">{result ? <CompileResult result={result} /> : null}</div>

      <div className="space-y-2 pt-8">
        {result?.compiled ? (
          <>
            <Button onClick={onNext}>Continue</Button>
            <Button variant="ghost" onClick={() => void compile()} loading={busy}>
              Compile again
            </Button>
          </>
        ) : (
          <Button onClick={() => void compile()} loading={busy} disabled={empty}>
            {busy ? 'Compiling' : 'Compile'}
          </Button>
        )}
      </div>
    </>
  );
}

export function CompileResult({ result }: { result: CompileResponse }) {
  return (
    <div className="space-y-4 pt-5" data-testid="compile-result">
      {result.issues.length > 0 ? (
        <section aria-label="Problems">
          <h2 className="pb-2 text-h3 font-semibold text-ink">Fix these first</h2>
          <ul className="space-y-2">
            {result.issues.map((i, n) => (
              <li key={`${i.path}-${n}`} className="rounded-md bg-deny-tint p-3">
                <p className="text-small text-deny">{i.message}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.sentences.length > 0 ? (
        <section aria-label="Compiled rules">
          <h2 className="flex items-center justify-between pb-2 text-h3 font-semibold text-ink">
            Thesauros will follow these rules
            {result.compiled ? <VerdictBadge tone="allow" label="Compiled" /> : null}
          </h2>
          <ol className="list-decimal space-y-2 rounded-md bg-surface-2 py-4 pr-4 pl-9 text-small text-ink">
            {result.sentences.map((s, n) => (
              <li key={n}>{s}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {result.assumptions.length > 0 ? (
        <section aria-label="Assumptions">
          <h2 className="pb-2 text-h3 font-semibold text-ink">What Thesauros assumed</h2>
          <ul className="list-disc space-y-1 pl-5 text-small text-muted">
            {result.assumptions.map((a, n) => (
              <li key={n}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.questions.length > 0 ? (
        <section aria-label="Questions">
          <h2 className="pb-2 text-h3 font-semibold text-ink">Thesauros needs an answer</h2>
          <ul className="list-disc space-y-1 pl-5 text-small text-escalate">
            {result.questions.map((q, n) => (
              <li key={n}>{q}</li>
            ))}
          </ul>
          <p className="pt-2 text-small text-muted">
            Edit your mandate to answer, then compile again.
          </p>
        </section>
      ) : null}
    </div>
  );
}

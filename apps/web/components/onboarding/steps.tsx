'use client';
// Onboarding steps 1-3. Step 4 is the policy-signing step: see PolicySign.tsx.
import { useState } from 'react';
import {
  IconBolt,
  IconBrain,
  IconCheck,
  IconCode,
  IconCopy,
  IconExternal,
  IconForward,
  IconGas,
  IconHome,
  IconLock,
  IconPalette,
  IconReset,
  IconShieldCheck,
  IconSnow,
  IconTerminal,
  IconWallet,
  type IconComponent,
} from '@/components/icons';
import {
  Button,
  ErrorPanel,
  IconTile,
  PageHeading,
  StickyCta,
  Tag,
  type TagTone,
} from '@/components/primitives';
import { ApiError, apiPost } from '@/lib/api';
import { zCompile, zProvision, type CompileResponse, type OnboardingState } from '@/lib/contracts';
import { groupAddress } from '@/lib/format';
import { isExampleText, TEMPLATE_CHIPS, type TemplateValue } from '@/lib/mandateExamples';

/* ------------------------------------------------------------- 1 meet Thesauros */

function Pillar({
  icon,
  tone,
  tag,
  tagTone,
  title,
  children,
  foot,
}: {
  icon: IconComponent;
  tone?: 'neutral' | 'deny';
  tag: string;
  tagTone: TagTone;
  title: string;
  children: string;
  foot?: React.ReactNode;
}) {
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between">
        <IconTile icon={icon} tone={tone} />
        <Tag tone={tagTone}>{tag}</Tag>
      </div>
      <div>
        <h2 className="text-title leading-[22px] font-semibold text-ink">{title}</h2>
        <p className="pt-1 text-ui leading-5 text-muted">{children}</p>
      </div>
      {foot}
    </section>
  );
}

export function MeetStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <PageHeading sub="An autonomous treasury that works under rules you sign. You can stop everything at any second.">
        Meet Thesauros
      </PageHeading>
      <div className="flex flex-col gap-3 pt-5">
        <Pillar
          icon={IconBrain}
          tag="Non-custodial"
          tagTone="neutral"
          title="Reasoning proposes"
          foot={
            <div className="flex h-8 items-end gap-1" aria-hidden="true">
              {[3, 5, 4, 7].map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-[3px] bg-surface-3"
                  style={{ height: h * 4 }}
                />
              ))}
              <span className="h-8 flex-1 rounded-[3px] bg-accent" />
            </div>
          }
        >
          The model suggests moves: rebalance, pay, park idle cash. It never holds your keys and
          cannot send anything itself.
        </Pillar>
        <Pillar
          icon={IconShieldCheck}
          tag="Deterministic"
          tagTone="neutral"
          title="Code disposes"
          foot={
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-1 text-cap font-semibold text-muted">
                <IconCheck className="size-3.5 text-ink" /> Exact-match allowlist
              </span>
              <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-1 text-cap font-semibold text-muted">
                <IconCode className="size-3.5 text-ink" /> Simulated before sent
              </span>
            </div>
          }
        >
          Every move is checked against your signed rules by plain code. One failed rule and nothing
          happens.
        </Pillar>
        <Pillar
          icon={IconSnow}
          tone="deny"
          tag="Hard override"
          tagTone="deny"
          title="Instant freeze"
        >
          The Freeze button sits in the header on every screen. It works even if the model or the
          Thesauros worker is down.
        </Pillar>
        <div className="flex items-center gap-3 rounded-md bg-surface-3/60 p-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
            <IconLock className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-meta font-semibold text-ink">
              Your wallet signs, always
            </span>
            <span className="block text-meta text-muted">
              Policy changes, approvals and unfreezing all need your signature.
            </span>
          </span>
        </div>
      </div>
      <StickyCta note="Non-custodial. Only you can change the rules or unfreeze.">
        <Button onClick={onNext}>
          Continue <IconForward className="size-5" />
        </Button>
      </StickyCta>
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
  explorerBase,
}: {
  address: string | null;
  onNext: () => void;
  onCreated: () => void;
  explorerBase: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the address is on screen and selectable */
    }
  };

  return (
    <>
      <PageHeading sub="The dedicated wallet Thesauros acts from. It is separate from your own wallet and your treasury.">
        Agent wallet
      </PageHeading>

      <section className="card mt-5 p-4">
        <div className="flex items-center justify-between gap-2 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-ink">
              <IconWallet className="size-[18px]" />
            </span>
            <span>
              <span className="block text-title leading-5 font-semibold text-ink">
                Agent wallet
              </span>
              <span className="label">Circle Wallets</span>
            </span>
          </div>
          {address ? (
            <Tag tone="quiet" dot="pulse">
              Provisioned
            </Tag>
          ) : (
            <Tag tone="quiet">Not created</Tag>
          )}
        </div>

        <div className="rounded-md bg-surface-2 p-4">
          <div className="flex items-center justify-between pb-1.5">
            <span className="label">Address</span>
            <span className="flex items-center gap-1 text-cap font-semibold text-muted">
              <IconLock className="size-3.5" /> Circle holds the key
            </span>
          </div>
          {address ? (
            <p
              className="font-mono text-h2 leading-8 tracking-[0.06em] break-words text-ink select-all"
              aria-label={address}
            >
              {groupAddress(address).replace(/^0x /, '0x')}
            </p>
          ) : (
            <p className="py-1 text-ui leading-5 text-muted">
              Not created yet. Creating it costs nothing and moves no funds.
            </p>
          )}
        </div>

        {address ? (
          <div className="flex items-center gap-2 pt-3">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-surface-3 text-meta font-semibold text-ink hover:brightness-95 active:scale-[0.98]"
            >
              {copied ? (
                <IconCheck className="size-[18px]" />
              ) : (
                <IconCopy className="size-[18px]" />
              )}
              {copied ? 'Copied' : 'Copy address'}
            </button>
            <a
              href={`${explorerBase}/address/${address}`}
              target="_blank"
              rel="noreferrer"
              aria-label="View the agent wallet on the explorer"
              className="flex size-11 items-center justify-center rounded-md bg-surface-3 text-ink hover:brightness-95"
            >
              <IconExternal className="size-[18px]" />
            </a>
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-cap">
          <span className="flex items-center gap-1.5 text-muted">
            <IconGas className="size-4 text-ink" /> Gas via Circle Paymaster
          </span>
          <span className="font-semibold text-ink">Paid in USDC on Arc</span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 pt-3">
        <div className="card p-4">
          <IconTile icon={IconLock} size="sm" />
          <p className="pt-2 text-small leading-5 font-semibold text-ink">Kept separate</p>
          <p className="pt-1 text-fine leading-4 text-muted">
            It can only reach what you move into it and what your policy allows.
          </p>
        </div>
        <div className="card p-4">
          <IconTile icon={IconSnow} size="sm" />
          <p className="pt-2 text-small leading-5 font-semibold text-ink">Freezable anytime</p>
          <p className="pt-1 text-fine leading-4 text-muted">
            Freeze stops every proposal and execution from it immediately.
          </p>
        </div>
      </div>

      {error ? (
        <div className="-mx-4 pt-4" aria-live="polite">
          <ErrorPanel title="Wallet not created" body={error} />
        </div>
      ) : null}

      <StickyCta note="This wallet only ever holds what you allow.">
        {address ? (
          <Button onClick={onNext}>
            Continue to mandate <IconForward className="size-5" />
          </Button>
        ) : (
          <Button onClick={() => void create()} loading={busy}>
            {busy ? 'Creating' : 'Create agent wallet'}
          </Button>
        )}
      </StickyCta>
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

const PRESET_ICON: Record<(typeof TEMPLATE_CHIPS)[number]['value'], IconComponent> = {
  startup: IconBolt,
  dao: IconHome,
  creator: IconPalette,
};

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
          sentences: saved.sentences,
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

  const reset = () => {
    const chip = TEMPLATE_CHIPS.find((c) => c.value === template) ?? TEMPLATE_CHIPS[0];
    setTemplate(chip.value);
    setText(chip.text);
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
      <PageHeading sub="Say in plain English what Thesauros should do with idle USDC. It compiles into rules you review and sign next.">
        Set your mandate
      </PageHeading>

      <div
        role="group"
        aria-label="Start from a template"
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pt-5 pb-1"
      >
        {TEMPLATE_CHIPS.map((c) => {
          const on = template === c.value;
          const Icon = PRESET_ICON[c.value];
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              onClick={() => pick(c.value, c.text)}
              className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-meta font-semibold transition-transform active:scale-95 ${
                on ? 'bg-accent text-on-accent' : 'bg-card text-ink shadow-e1 hover:bg-surface-2'
              }`}
            >
              <Icon className={`size-4 ${on ? '' : 'text-muted'}`} />
              {c.label}
            </button>
          );
        })}
      </div>

      <section className="card mt-3 flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-title font-semibold text-ink">Mandate</span>
            <Tag tone="quiet">Plain English</Tag>
          </span>
          {result?.compiled ? (
            <Tag tone="soft">
              <IconCheck className="size-3.5" /> {result.sentences.length || 'All'} rules compiled
            </Tag>
          ) : null}
        </div>
        <label className="block rounded-sm bg-surface-2 p-3.5 transition-shadow focus-within:ring-2 focus-within:ring-accent">
          <span className="sr-only">Your mandate</span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (template !== 'custom' && !isExampleText(e.target.value)) setTemplate('custom');
              setResult(null);
            }}
            maxLength={4000}
            rows={5}
            spellCheck={false}
            className="w-full resize-none border-0 bg-transparent text-small leading-6 text-ink outline-none placeholder:text-faint"
            placeholder="Keep 20,000 USDC liquid. Put the rest in the approved vault. Pay the contractors every Friday."
          />
          <span className="flex items-center justify-between pt-2">
            <span className="text-cap text-muted">{text.length} / 4000</span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-8 items-center gap-1 text-cap font-semibold text-muted hover:text-ink"
            >
              <IconReset className="size-3.5" /> Reset
            </button>
          </span>
        </label>
      </section>

      {error ? (
        <div className="-mx-4 pt-4" aria-live="polite">
          <ErrorPanel title="Not compiled" body={error} />
        </div>
      ) : null}

      <div aria-live="polite">{result ? <CompileResult result={result} /> : null}</div>

      <div className="mt-3 flex items-center gap-3 rounded-md bg-surface-3/60 p-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-ink shadow-e1">
          <IconShieldCheck className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-ui font-semibold text-ink">Deterministic enforcement</span>
          <span className="block text-fine leading-4 text-muted">
            The model drafts the rules; plain code enforces them. Nothing runs until you sign.
          </span>
        </span>
      </div>

      <StickyCta note="Compiling saves a draft. It moves no money.">
        {result?.compiled ? (
          <>
            <Button onClick={onNext}>
              Continue to review <IconForward className="size-5" />
            </Button>
            <Button variant="quiet" onClick={() => void compile()} loading={busy} className="h-10">
              Compile again
            </Button>
          </>
        ) : (
          <Button onClick={() => void compile()} loading={busy} disabled={empty}>
            {busy ? null : <IconTerminal className="size-5" />}
            {busy ? 'Compiling' : 'Compile mandate'}
          </Button>
        )}
      </StickyCta>
    </>
  );
}

export function CompileResult({ result }: { result: CompileResponse }) {
  return (
    <div className="flex flex-col gap-3 pt-3" data-testid="compile-result">
      {result.issues.length > 0 ? (
        <section aria-label="Problems" className="rounded-md bg-deny-tint p-4">
          <h2 className="pb-2 text-small font-bold text-deny">Fix these first</h2>
          <ul className="space-y-1.5">
            {result.issues.map((i, n) => (
              <li key={`${i.path}-${n}`} className="text-meta leading-[18px] text-ink">
                {i.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.sentences.length > 0 ? (
        <section aria-label="Compiled rules" className="card p-4">
          <p className="label pb-2">Compiled guardrails</p>
          <ul className="space-y-2">
            {result.sentences.map((s, n) => (
              <li key={n} className="flex gap-2 text-ui leading-5 text-ink">
                <span
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent ring-2 ring-accent-soft"
                  aria-hidden="true"
                />
                {s}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.assumptions.length > 0 ? (
        <section aria-label="Assumptions" className="card p-4">
          <p className="label pb-2">What Thesauros assumed</p>
          <ul className="list-disc space-y-1 pl-5 text-meta leading-[18px] text-muted">
            {result.assumptions.map((a, n) => (
              <li key={n}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.questions.length > 0 ? (
        <section aria-label="Questions" className="rounded-md bg-escalate-tint p-4">
          <p className="pb-2 text-ui font-bold text-escalate">Thesauros needs an answer</p>
          <ul className="list-disc space-y-1 pl-5 text-meta leading-[18px] text-ink">
            {result.questions.map((q, n) => (
              <li key={n}>{q}</li>
            ))}
          </ul>
          <p className="pt-2 text-fine text-muted">
            Edit your mandate to answer, then compile again.
          </p>
        </section>
      ) : null}
    </div>
  );
}

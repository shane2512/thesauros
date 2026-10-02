'use client';
// Onboarding wizard. RESUMABLE: which step the owner may reach comes from GET /api/onboarding
// (server state), never from the browser. Steps 1-3 are built here; step 4 is the policy-signing
// step and renders PolicySign directly (Steward's own step 4, the Spend Permission grant, has no
// Circle equivalent at all — D-012/D-019 item 9 — so this wizard has one fewer step).
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IconBack } from '@/components/icons';
import { ErrorPanel, LoadBar, PageHeading, Skeleton, Tag } from '@/components/primitives';
import { zConfig, zOnboarding } from '@/lib/contracts';
import { clampView, initialView, type WizardStep } from '@/lib/onboarding';
import { useApi } from '@/lib/useApi';
import { PolicySign } from '@/components/sign/PolicySign';
import { MandateStep, MeetStep, WalletStep } from './steps';

const TOTAL_STEPS = 4;

/** Back arrow, a segmented progress rail (done = ink, current = orange), "Step n of 4". Reached
 * segments are buttons back to that step. */
export function StepProgress({
  current,
  onStepClick,
}: {
  current: number;
  onStepClick?: (step: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 pt-2">
      {current > 1 && onStepClick ? (
        <button
          type="button"
          onClick={() => onStepClick(current - 1)}
          aria-label="Back"
          className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface-3"
        >
          <IconBack className="size-[22px]" />
        </button>
      ) : null}
      <div
        className="flex flex-1 items-center gap-1.5"
        role="progressbar"
        aria-label="Onboarding progress"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={current}
      >
        {Array.from({ length: TOTAL_STEPS }, (_, idx) => idx + 1).map((i) => {
          const cls = `block h-1.5 w-full rounded-full transition-colors duration-300 ${
            i < current ? 'bg-ink' : i === current ? 'bg-accent' : 'bg-surface-3'
          }`;
          return i < current && onStepClick ? (
            <button
              key={i}
              type="button"
              onClick={() => onStepClick(i)}
              aria-label={`Go back to step ${i}`}
              className="flex h-11 flex-1 items-center"
            >
              <span className={cls} />
            </button>
          ) : (
            <span key={i} className="flex h-11 flex-1 items-center">
              <span className={cls} />
            </span>
          );
        })}
      </div>
      <span className="label shrink-0">
        Step {current} of {TOTAL_STEPS}
      </span>
    </div>
  );
}

export function OnboardingFlow() {
  const router = useRouter();
  const ob = useApi('/api/onboarding', zOnboarding);
  const cfg = useApi('/api/config', zConfig);
  const [view, setView] = useState<WizardStep | null>(null);
  const data = ob.data;
  const testnet = (cfg.data?.chainId ?? 5042002) === 5042002;

  useEffect(() => {
    if (data?.step === 'done') router.replace('/app');
  }, [data?.step, router]);

  if (ob.error && !data)
    return (
      <div className="pt-8">
        <ErrorPanel
          title="Thesauros could not load your setup"
          body="Nothing moved. Check your connection and try again."
          onRetry={ob.refetch}
        />
      </div>
    );
  if (!data || data.step === 'done')
    return (
      <div className="space-y-4 px-4 pt-8" aria-busy="true">
        <LoadBar active />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full rounded-md" />
      </div>
    );

  const furthest = data.step;
  const current: WizardStep =
    view === null
      ? initialView(furthest, data.agentWalletAddress !== null)
      : clampView(view, furthest);
  const go = (n: number) => setView(clampView(n, furthest));
  const resume = () => {
    setView(null);
    ob.refetch();
  };

  return (
    <div data-step={current} className="px-4">
      <StepProgress current={current} onStepClick={go} />
      <div className="flex justify-end pb-3">
        <Tag tone="neutral" dot="pulse">
          {testnet ? 'Arc Testnet' : 'Arc'} · Non-custodial
        </Tag>
      </div>

      {current === 1 ? <MeetStep onNext={() => go(2)} /> : null}
      {current === 2 ? (
        <WalletStep
          address={data.agentWalletAddress}
          onCreated={() => ob.refetch()}
          onNext={() => go(3)}
          explorerBase={cfg.data?.explorerBase ?? 'https://explorer.testnet.arc.io'}
        />
      ) : null}
      {current === 3 ? (
        <MandateStep saved={data.mandate} onCompiled={() => ob.refetch()} onNext={() => go(4)} />
      ) : null}
      {current === 4 ? (
        <>
          <PageHeading
            kicker="Deterministic enactment"
            sub="Read the rules once more. Signing makes them the only rules Thesauros can act under."
          >
            Review &amp; activate
          </PageHeading>
          <div className="pt-5">
            <PolicySign onActivated={resume} onEdit={() => go(3)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

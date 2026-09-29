'use client';
// Policy screen. Sentences view is the default; JSON is an explicit, secondary toggle. "Edit
// mandate" re-enters the SAME mandate compile step the onboarding wizard uses and, once it
// compiles, hands off to the SAME PolicySign used at onboarding — one diff+sign surface for every
// path that changes the policy.
import { useState } from 'react';
import { MandateStep } from '@/components/onboarding/steps';
import { PolicySign } from '@/components/sign/PolicySign';
import {
  Button,
  EmptyState,
  ErrorPanel,
  RowSkeleton,
  SegmentedControl,
  TextButton,
} from '@/components/primitives';
import { zOnboarding, zPolicyView } from '@/lib/contracts';
import { useApi } from '@/lib/useApi';

type View = 'sentences' | 'json';
type Mode = 'read' | 'edit' | 'sign';

export function PolicyScreen() {
  const [view, setView] = useState<View>('sentences');
  const [mode, setMode] = useState<Mode>('read');
  const policy = useApi('/api/policy', zPolicyView);
  const onboarding = useApi('/api/onboarding', zOnboarding, { enabled: mode === 'edit' });

  const backToRead = () => {
    setMode('read');
    policy.refetch();
  };

  if (mode === 'edit')
    return (
      <div className="px-4 pt-6">
        <TextButton onClick={() => setMode('read')}>← Back to policy</TextButton>
        {onboarding.isLoading ? (
          <RowSkeleton />
        ) : (
          <div className="pt-4">
            <MandateStep
              saved={onboarding.data?.mandate ?? null}
              onCompiled={() => setMode('sign')}
              onNext={() => setMode('sign')}
            />
          </div>
        )}
      </div>
    );

  if (mode === 'sign')
    return (
      <div className="px-4 pt-6">
        <TextButton onClick={() => setMode('edit')}>← Back to edit</TextButton>
        <div className="pt-4">
          <PolicySign onActivated={backToRead} />
        </div>
      </div>
    );

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-4">
        <SegmentedControl
          label="View"
          options={[
            { value: 'sentences', label: 'Sentences' },
            { value: 'json', label: 'JSON (reference)' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <div className="px-4 pt-4" aria-live="polite">
        {policy.isLoading ? (
          <RowSkeleton />
        ) : policy.error ? (
          <ErrorPanel
            title="Thesauros could not load your policy"
            body="Nothing changed. Check your connection and try again."
            onRetry={policy.refetch}
          />
        ) : !policy.data?.version ? (
          <EmptyState
            title="No policy yet"
            body="Compile a mandate and sign it to give Thesauros its first policy."
            action={<Button onClick={() => setMode('edit')}>Write your mandate</Button>}
          />
        ) : view === 'sentences' ? (
          <div data-testid="policy-sentences-view">
            <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
              Policy v{policy.data.version}
            </p>
            <ol className="mt-2 space-y-2 rounded-md bg-surface-2 p-4">
              {policy.data.sentences.map((s, i) => (
                <li key={s} className="flex gap-3 text-small text-ink">
                  <span className="shrink-0 font-mono text-mono text-faint">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div data-testid="policy-json-view">
            <p className="pb-2 text-small text-muted">
              For reference only. This is not something you edit directly — use Edit mandate below.
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-2 p-4 font-mono text-mono text-ink">
              {JSON.stringify(policy.data.body, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="px-4 pt-6">
        <Button variant="ghost" onClick={() => setMode('edit')}>
          Edit mandate
        </Button>
      </div>
    </div>
  );
}

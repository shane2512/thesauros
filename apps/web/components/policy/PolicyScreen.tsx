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
  PageHeading,
  RowSkeleton,
  SegmentedControl,
  Tag,
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
      <div className="px-4 pt-2">
        <TextButton className="-ml-3" onClick={() => setMode('read')}>
          ← Back to policy
        </TextButton>
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
      <div className="px-4 pt-2">
        <TextButton className="-ml-3" onClick={() => setMode('edit')}>
          ← Back to edit
        </TextButton>
        <div className="pt-2">
          <PolicySign onActivated={backToRead} onEdit={() => setMode('edit')} />
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <PageHeading sub="The only rules Thesauros can act under. Plain code checks every move against them.">
        Your policy
      </PageHeading>
      <div>
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

      <div aria-live="polite">
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
            <div className="flex items-center justify-between px-0.5 pb-2">
              <span className="label">Active directives ({policy.data.sentences.length})</span>
              <Tag tone="accent">v{policy.data.version} active</Tag>
            </div>
            <ol className="card divide-y divide-line overflow-hidden">
              {policy.data.sentences.map((s, i) => (
                <li key={s} className="flex items-start gap-3 p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-3 font-display text-ui font-bold text-ink">
                    {i + 1}
                  </span>
                  <span className="pt-1 text-ui leading-5 text-ink">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div data-testid="policy-json-view">
            <p className="pb-2 text-meta text-muted">
              For reference only. This is not something you edit directly — use Edit mandate below.
            </p>
            <pre className="card overflow-x-auto p-4 font-mono text-fine leading-5 text-ink">
              {JSON.stringify(policy.data.body, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {policy.data?.version ? (
        <Button variant="ghost" onClick={() => setMode('edit')}>
          Edit mandate
        </Button>
      ) : null}
    </div>
  );
}

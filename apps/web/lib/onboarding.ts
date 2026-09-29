// Which onboarding step the SERVER state allows (resumable; the browser is never the source). This
// only picks a screen — every action behind a step is checked again by its own route.
//
// Steward's own version has 5 steps, including a spend-permission-grant step between the mandate
// and policy-signing steps. Dropped here, not adapted: Circle's model has no on-chain spend
// permission to grant at all (D-012/D-019 item 9), so this wizard has one fewer step.
export type OnboardingFacts = {
  hasWallet: boolean;
  agentWalletAddress: string | null;
  mandateCompiled: boolean;
  activePolicyVersion: number | null;
};

export type OnboardingStep = 1 | 2 | 3 | 4 | 'done';

export function deriveOnboardingStep(f: OnboardingFacts): OnboardingStep {
  if (f.activePolicyVersion !== null) return 'done';
  if (!f.hasWallet || !f.agentWalletAddress) return 2; // step 1 is a read-only "meet Thesauros" screen the owner may still open first
  if (!f.mandateCompiled) return 3;
  return 4;
}

export const STEP_TITLES = [
  'Meet Thesauros',
  'Create the agent wallet',
  'Write your mandate',
  'Sign your policy',
] as const;

/** The steps the owner may look at: everything up to and including the furthest one. */
export function reachableSteps(furthest: OnboardingStep): number {
  return furthest === 'done' ? 4 : furthest;
}

export type WizardStep = 1 | 2 | 3 | 4;

/** Where the wizard opens: a brand-new owner sees "Meet Thesauros" first, a returning one resumes. */
export function initialView(furthest: OnboardingStep, hasAgentWallet: boolean): WizardStep {
  if (furthest === 'done') return 4;
  if (!hasAgentWallet && furthest === 2) return 1;
  return furthest;
}

/** The owner may go back freely, but never past what the server state allows. */
export function clampView(view: number, furthest: OnboardingStep): WizardStep {
  const max = reachableSteps(furthest);
  return Math.min(Math.max(Math.trunc(view), 1), max) as WizardStep;
}

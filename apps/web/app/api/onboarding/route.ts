import { NextResponse } from 'next/server';
import { getLatestMandate } from '@thesauros/db';
import { requireWallet } from '@/lib/requireWallet';
import { apiError } from '@/lib/apiError';
import { deriveOnboardingStep } from '@/lib/onboarding';
import { db } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return apiError(401, 'unauthorized', 'Sign in first.');

  const mandate = await getLatestMandate(db(), auth.wallet.id);
  const step = deriveOnboardingStep({
    hasWallet: true,
    agentWalletAddress: auth.wallet.agentWalletAddress,
    mandateCompiled: mandate?.compiledDraft !== null && mandate?.compiledDraft !== undefined,
    activePolicyVersion: auth.wallet.activePolicyVersion,
  });

  return NextResponse.json({
    step,
    agentWalletAddress: auth.wallet.agentWalletAddress,
    mandate: mandate
      ? {
          id: mandate.id,
          text: mandate.text,
          sentences: [] as string[],
          assumptions: (mandate.assumptions as string[]) ?? [],
          questions: (mandate.questions as string[]) ?? [],
          compiled: mandate.compiledDraft !== null,
        }
      : null,
    activePolicyVersion: auth.wallet.activePolicyVersion,
  });
}

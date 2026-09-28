import { NextResponse } from 'next/server';
import { setAgentWallet } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';
import { createCircleClient, provisionTreasuryWallet } from '@thesauros/wallet';
import { requireWallet } from '@/lib/requireWallet';
import { db } from '@/lib/db';

export async function POST(): Promise<NextResponse> {
  const auth = await requireWallet();
  if (!auth) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  if (auth.wallet.agentWalletAddress) {
    return NextResponse.json(
      { error: 'this treasury already has a provisioned wallet' },
      { status: 409 },
    );
  }

  const env = getEnv();
  if (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET) {
    return NextResponse.json({ error: 'Circle credentials are not configured' }, { status: 503 });
  }

  const client = createCircleClient({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });
  const provisioned = await provisionTreasuryWallet(client, {
    name: `thesauros-${auth.wallet.id}`,
  });
  if (!provisioned.ok) return NextResponse.json({ error: provisioned.error }, { status: 502 });

  await setAgentWallet(db(), auth.wallet.id, {
    address: provisioned.value.address,
    walletSetId: provisioned.value.walletSetId,
    circleWalletId: provisioned.value.walletId,
  });

  return NextResponse.json({ agentWalletAddress: provisioned.value.address });
}

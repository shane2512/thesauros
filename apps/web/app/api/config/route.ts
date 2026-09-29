import { NextResponse } from 'next/server';
import { getEnv } from '@thesauros/shared';

export async function GET(): Promise<NextResponse> {
  const env = getEnv();
  return NextResponse.json({
    demoMode: env.DEMO_MODE,
    chainId: env.CHAIN_ID,
    // docs/VERIFY.md row 13 confirms the mainnet explorer (explorer.arc.io); the testnet one
    // follows the same rpc.arc.io -> rpc.testnet.arc.io naming but hasn't been independently
    // verified — fine for a "view on explorer" link, not depended on for anything money-moving.
    explorerBase:
      env.CHAIN_ID === 5042 ? 'https://explorer.arc.io' : 'https://explorer.testnet.arc.io',
  });
}

// Arc has no built-in viem chain definition yet (docs/VERIFY.md rows 1/2/13). Shared by the worker
// and the web app so both read through the identical RPC config rather than two hand-copies drifting.
import { createPublicClient, defineChain, http, type PublicClient } from 'viem';
import type { Env } from '@thesauros/shared';

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
});
export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
});

export function publicClientFor(env: Pick<Env, 'CHAIN_ID' | 'ARC_RPC_URL'>): PublicClient {
  return createPublicClient({
    chain: env.CHAIN_ID === 5042 ? arcMainnet : arcTestnet,
    transport: http(env.ARC_RPC_URL),
  }) as PublicClient;
}

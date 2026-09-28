// Worker runtime wiring: turn the validated env into the ports the loop needs, once, at boot.
//
// Nothing here makes a decision. It builds: the RPC client, the Circle client (through
// `@thesauros/wallet`, the only package `check:arch` lets construct one), a per-wallet send-capable
// `TxSender`, the SERV client, the I11-fenced price adapter and the demo price refresher, plus the
// SERV circuit breaker that 6.7's degraded mode reads.
import { createPublicClient, defineChain, getAddress, http, type PublicClient } from 'viem';
import { appendAudit, getWalletById, type Db } from '@thesauros/db';
import { LiveServClient, type ServClient } from '@thesauros/reasoning';
import { mockPriceFeedAdapter, type PriceAdapter } from '@thesauros/risk';
import { createLogger, type Address, type Env } from '@thesauros/shared';
import {
  circleTxSender,
  createCircleClient,
  demoPriceRefresher,
  type CircleClient,
  type DemoPriceRefresher,
  type TxSender,
} from '@thesauros/wallet';

const log = createLogger('runtime');

// docs/VERIFY.md rows 1/2/13 — Arc has no built-in viem chain definition yet.
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

export function publicClientFor(env: Env): PublicClient {
  return createPublicClient({
    chain: env.CHAIN_ID === 5042 ? arcMainnet : arcTestnet,
    transport: http(env.ARC_RPC_URL),
  }) as PublicClient;
}

/** RECEIPT_HMAC_SECRET as bytes. Fails loudly at boot: a worker without it can never execute. */
export function receiptKeyFor(env: Env): Uint8Array {
  if (!env.RECEIPT_HMAC_SECRET)
    throw new Error(
      'RECEIPT_HMAC_SECRET is required: the worker cannot verify receipts without it',
    );
  return new TextEncoder().encode(env.RECEIPT_HMAC_SECRET.reveal());
}

export function servClientFor(
  env: Env,
): { client: ServClient; proposerModel: string; verifierModel: string } | undefined {
  if (!env.SERV_API_KEY) {
    log.warn('SERV_API_KEY is not set: the worker runs in degraded mode (deterministic only)');
    return undefined;
  }
  return {
    client: new LiveServClient({ apiKey: env.SERV_API_KEY, baseURL: env.SERV_BASE_URL }),
    proposerModel: env.SERV_MODEL_PROPOSER,
    verifierModel: env.SERV_MODEL_VERIFIER,
  };
}

/** I11: only ever a mock feed, only on Arc testnet, only in DEMO_MODE. */
export function priceAdapterFor(env: Env, publicClient: PublicClient): PriceAdapter | undefined {
  if (!env.MOCK_PRICE_FEED_ADDRESS) return undefined;
  const adapter = mockPriceFeedAdapter({
    publicClient,
    feed: getAddress(env.MOCK_PRICE_FEED_ADDRESS),
    token: getAddress(env.USDC_ADDRESS),
    chainId: env.CHAIN_ID,
    demoMode: env.DEMO_MODE,
  });
  if (!adapter.ok) {
    log.warn({ reason: adapter.error }, 'no price adapter; priced actions will fail closed (R12)');
    return undefined;
  }
  return adapter.value;
}

function circleClientFor(env: Env): CircleClient | undefined {
  if (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET) return undefined;
  return createCircleClient({ apiKey: env.CIRCLE_API_KEY, entitySecret: env.CIRCLE_ENTITY_SECRET });
}

export { circleClientFor };

export function demoPriceRefresherFor(env: Env): DemoPriceRefresher | undefined {
  if (!env.DEMO_MODE || !env.MOCK_PRICE_FEED_ADDRESS || !env.DEMO_ADMIN_CIRCLE_WALLET_ID)
    return undefined;
  const client = circleClientFor(env);
  if (!client) return undefined;
  return demoPriceRefresher(
    client,
    env.DEMO_ADMIN_CIRCLE_WALLET_ID,
    getAddress(env.MOCK_PRICE_FEED_ADDRESS),
  );
}

/**
 * The agent wallet's sender, one per treasury wallet. `wallets.agent_wallet_ref` holds the Circle
 * `{ circleWalletId }` provisioning wrote (`provisionTreasuryWallet`); this only reads it back, it
 * never provisions — a wallet with no ref yet has no sender, and the loop skips it (6.6-adjacent).
 */
export function senderFactory(db: Db, env: Env): (walletId: string) => Promise<TxSender> {
  const client = circleClientFor(env);
  if (!client)
    throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required to run the worker');
  const cache = new Map<string, TxSender>();
  return async (walletId: string) => {
    const cached = cache.get(walletId);
    if (cached) return cached;
    const wallet = await getWalletById(db, walletId);
    if (!wallet?.agentWalletAddress || !wallet.agentWalletRef)
      throw new Error(`wallet ${walletId} has not been provisioned with a Circle wallet yet`);
    const ref = wallet.agentWalletRef as { circleWalletId?: string };
    if (!ref.circleWalletId)
      throw new Error(`wallet ${walletId}'s agent_wallet_ref has no circleWalletId`);
    const sender = circleTxSender(
      client,
      ref.circleWalletId,
      getAddress(wallet.agentWalletAddress),
    );
    cache.set(walletId, sender);
    return sender;
  };
}

/**
 * 6.7 — the SERV circuit breaker.
 *
 * Consecutive failures open it; one success closes it. While open, `preChecks` runs in degraded
 * mode and only deterministic proposals are built. Transitions write to the SYSTEM audit chain
 * (SERV is one service, not one wallet's problem), and `/api/wallet` reads the latest transition to
 * show the `degraded` flag — no new column, and the flag is as auditable as everything else.
 */
export const SERV_FAILURE_THRESHOLD = 3;
/** How long the breaker stays open before the next iteration is allowed to try SERV again. */
export const SERV_COOLDOWN_MS = 5 * 60_000;

export class ServBreaker {
  #failures = 0;
  #openedAt: Date | null = null;

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** True when SERV should not be called this iteration. */
  get degraded(): boolean {
    if (this.#openedAt === null) return false;
    if (this.now().getTime() - this.#openedAt.getTime() >= SERV_COOLDOWN_MS) return false;
    return true;
  }

  async recordFailure(task: string, detail: string): Promise<void> {
    this.#failures += 1;
    if (this.#failures < SERV_FAILURE_THRESHOLD || this.#openedAt !== null) return;
    const at = this.now();
    this.#openedAt = at;
    log.error({ task, detail, failures: this.#failures }, 'SERV breaker open: degraded mode');
    await appendAudit(this.db, {
      actor: 'system',
      event: 'SERV_DEGRADED',
      entityType: 'serv',
      entityId: 'serv',
      payload: { task, detail, failures: this.#failures },
      createdAt: at,
    });
  }

  async recordSuccess(): Promise<void> {
    this.#failures = 0;
    if (this.#openedAt === null) return;
    this.#openedAt = null;
    const at = this.now();
    log.info('SERV breaker closed');
    await appendAudit(this.db, {
      actor: 'system',
      event: 'SERV_RECOVERED',
      entityType: 'serv',
      entityId: 'serv',
      payload: { at: at.toISOString() },
      createdAt: at,
    });
  }
}

export type { Address };

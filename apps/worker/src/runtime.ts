// Worker runtime wiring: turn the validated env into the ports the loop needs, once, at boot.
//
// Nothing here makes a decision. It builds: the RPC client, the send-capable `TxSender` (through
// `@thesauros/wallet`, the only package `check:arch` lets construct a CDP client), the SERV client,
// the I11-fenced price adapter and the demo price refresher, plus the SERV circuit breaker that
// 6.7's degraded mode reads.
import { createPublicClient, http, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { appendAudit, type Db } from '@thesauros/db';
import { LiveServClient, type ServClient } from '@thesauros/reasoning';
import { mockPriceFeedAdapter, type PriceAdapter } from '@thesauros/risk';
import { createLogger, type Address, type Env } from '@thesauros/shared';
import {
  cdpAccountNames,
  cdpTxSender,
  createCdpClient,
  demoPriceRefresher,
  type DemoPriceRefresher,
  type TxSender,
} from '@thesauros/wallet';
import { getAddress } from 'viem';

const log = createLogger('runtime');

export function publicClientFor(env: Env): PublicClient {
  return createPublicClient({
    chain: env.CHAIN_ID === 8453 ? base : baseSepolia,
    transport: http(env.RPC_URL_BASE_SEPOLIA),
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

/** I11: only ever a mock feed, only on Base Sepolia, only in DEMO_MODE. */
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

/** CDP server account that owns the demo mocks (docs/addresses.md). */
export const DEMO_ADMIN_ACCOUNT = 'thesauros-demo-admin';

export function demoPriceRefresherFor(env: Env): DemoPriceRefresher | undefined {
  if (!env.DEMO_MODE || !env.MOCK_PRICE_FEED_ADDRESS) return undefined;
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET || !env.CDP_WALLET_SECRET) return undefined;
  const cdp = createCdpClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET.reveal(),
    walletSecret: env.CDP_WALLET_SECRET.reveal(),
  });
  const refresher = demoPriceRefresher({
    cdp: cdp.evm as unknown as Parameters<typeof demoPriceRefresher>[0]['cdp'],
    adminAccountName: DEMO_ADMIN_ACCOUNT,
    feed: getAddress(env.MOCK_PRICE_FEED_ADDRESS),
    chainId: env.CHAIN_ID,
    demoMode: env.DEMO_MODE,
  });
  if (!refresher.ok) {
    log.warn({ reason: refresher.error }, 'demo price refresh unavailable');
    return undefined;
  }
  return refresher.value;
}

/**
 * The agent wallet's sender, one per user (each owner has their own CDP smart account, D-3).
 * Cached: building it costs two CDP round trips.
 */
export function senderFactory(env: Env): (userId: string) => Promise<TxSender> {
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET || !env.CDP_WALLET_SECRET)
    throw new Error('CDP credentials are required to run the worker');
  const cdp = createCdpClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET.reveal(),
    walletSecret: env.CDP_WALLET_SECRET.reveal(),
  });
  const cache = new Map<string, TxSender>();
  return async (userId: string) => {
    const cached = cache.get(userId);
    if (cached) return cached;
    const names = cdpAccountNames(userId);
    if (!names.ok) throw new Error(names.error);
    const sender = await cdpTxSender({
      cdp: cdp.evm,
      names: names.value,
      network: env.CHAIN_ID === 8453 ? 'base' : 'base-sepolia',
    });
    if (!sender.ok) throw new Error(sender.error);
    cache.set(userId, sender.value);
    return sender.value;
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

// 5.2 — price adapters.
//
// V-13 recorded the honest state of the world: AgentKit's Pyth actions do not work on testnet
// (400/401 without a keyed Hermes endpoint). So the only adapter that actually returns a number
// today is the MockPriceFeed one, and it is fenced by I11: DEMO_MODE **and** Arc testnet's chain id
// (5042002), both checked here rather than at the call site. Every quote carries `demo: true` so
// the UI can show
// the "DEMO DATA" banner and the audit row records which source priced the action.
//
// `PriceAdapter` is the seam a real feed (Pyth with a keyed endpoint, Chainlink, an exchange TWAP)
// plugs into for mainnet. We deliberately ship no real adapter now: an unkeyed endpoint that
// silently returns stale or wrong numbers is worse than no oracle, because every Thesauros limit is
// denominated in micro-USD (D-29).
import { getAddress, type PublicClient } from 'viem';
import { err, ok, type Address, type Result } from '@thesauros/shared';

export type PriceQuoteResult = {
  /** USD with 6 decimals (I12). */
  microUsd: bigint;
  publishedAt: Date;
  /** Free-form provenance, stored on `price_snapshots.source`. */
  source: string;
  /** True when the quote came from a demo override (I11). The UI must label it. */
  demo: boolean;
};

export interface PriceAdapter {
  readonly name: string;
  /** Never throws; a missing or unreadable quote is `Err` and fails closed at R12. */
  getPrice(token: Address): Promise<Result<PriceQuoteResult>>;
}

const MOCK_PRICE_FEED_ABI = [
  {
    type: 'function',
    name: 'latestPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
    ],
  },
] as const;

export const ARC_TESTNET = 5042002; // docs/VERIFY.md row 1

export type MockPriceFeedOptions = {
  publicClient: PublicClient;
  /** The deployed MockPriceFeed (docs/addresses.md). */
  feed: Address;
  /** The one token this feed prices. A query for any other token is refused. */
  token: Address;
  chainId: number;
  demoMode: boolean;
};

/**
 * I11-fenced demo price source. Returns `Err` at construction time — not at first use — when the
 * fence does not hold, so a misconfigured deployment fails at startup instead of quietly pricing
 * mainnet funds off a mock.
 */
export function mockPriceFeedAdapter(options: MockPriceFeedOptions): Result<PriceAdapter> {
  const { publicClient, feed, token, chainId, demoMode } = options;
  if (!demoMode) return err('MockPriceFeed requires DEMO_MODE=true (I11)');
  if (chainId !== ARC_TESTNET)
    return err(`MockPriceFeed is only allowed on Arc testnet (${ARC_TESTNET}), not ${chainId}`);

  const feedAddress = getAddress(feed);
  const priced = getAddress(token);

  return ok({
    name: 'mock-price-feed',
    async getPrice(query: Address): Promise<Result<PriceQuoteResult>> {
      if (getAddress(query) !== priced)
        return err(`MockPriceFeed does not price ${query}, only ${priced}`);
      try {
        const [price, updatedAt] = await publicClient.readContract({
          address: feedAddress,
          abi: MOCK_PRICE_FEED_ABI,
          functionName: 'latestPrice',
        });
        if (price <= 0n) return err('MockPriceFeed returned a non-positive price');
        return ok({
          microUsd: price,
          publishedAt: new Date(Number(updatedAt) * 1000),
          source: `mock-price-feed:${feedAddress}`,
          demo: true,
        });
      } catch (e) {
        return err(`MockPriceFeed read failed: ${String(e)}`);
      }
    },
  });
}

/** The `price_snapshots` row body (DATA_MODEL). Written by the caller through `@thesauros/db`. */
export function priceSnapshotRow(token: Address, quote: PriceQuoteResult) {
  return {
    token: getAddress(token),
    microUsd: quote.microUsd,
    publishedAt: quote.publishedAt,
    source: quote.source,
  };
}

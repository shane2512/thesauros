// Phase 7 addendum — the derived treasury must be a pure function of the owner address.
//
// If derivation were not deterministic and idempotent, a second sign-in would point the treasury at
// a different contract and anything already sent to the first one would be stranded. There is no
// recovery from that, so it is tested as a property, not as an example.
//
// The factory read is stubbed with a transport that answers `eth_call` with keccak(calldata): the
// address then varies with, and ONLY with, the calldata viem builds. That makes this a test of the
// input we control (owner bytes + nonce + factory), which is where a bug would live — the CREATE2
// arithmetic behind the real factory is Coinbase's and is deterministic by construction.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  slice,
  type Hex,
  type PublicClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '@thesauros/shared';
import {
  COINBASE_SMART_WALLET_NONCE,
  COINBASE_SMART_WALLET_VERSION,
  deriveCompanionTreasury,
} from '../src/companionTreasury';

const factoryAbi = parseAbi([
  'function getAddress(bytes[] owners, uint256 nonce) view returns (address)',
]);

/** Every `eth_call` is answered with keccak(calldata), so identical input ⇒ identical address. */
function stubClient(onCall?: (call: { to: Hex; data: Hex }) => void): PublicClient {
  return createPublicClient({
    chain: baseSepolia,
    transport: custom({
      request: async ({ method, params }) => {
        if (method !== 'eth_call') throw new Error(`unexpected RPC: ${method}`);
        const call = (params as [{ to: Hex; data: Hex }])[0];
        onCall?.(call);
        return keccak256(call.data);
      },
    }),
  }) as unknown as PublicClient;
}

const addr = (seed: string): Address =>
  privateKeyToAccount(keccak256(Buffer.from(seed)) as Hex).address;

describe('deriveCompanionTreasury', () => {
  it('asks the pinned factory for getAddress([pad(owner)], 0) and nothing else', async () => {
    const calls: { to: Hex; data: Hex }[] = [];
    const owner = addr('owner-a');
    const r = await deriveCompanionTreasury(
      stubClient((c) => calls.push(c)),
      owner,
    );
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    // v1.1 factory. Changing this address moves every derived treasury, so it is asserted literally.
    expect(getAddress(call.to)).toBe(getAddress('0xba5ed110efdba3d005bfc882d75358acbbb85842'));
    expect(COINBASE_SMART_WALLET_VERSION).toBe('1.1');
    const decoded = decodeFunctionData({ abi: factoryAbi, data: call.data });
    expect(decoded.functionName).toBe('getAddress');
    const [owners, nonce] = decoded.args;
    // Exactly one owner, left-padded to 32 bytes: no ordering ambiguity, no second owner.
    expect(owners).toHaveLength(1);
    expect(getAddress(slice(owners[0]!, 12))).toBe(getAddress(owner));
    expect(nonce).toBe(COINBASE_SMART_WALLET_NONCE);
  });

  it('is deterministic and injective over owners (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 6 }),
        async (seeds) => {
          const owners = seeds.map(addr);
          const seen = new Map<Address, Address>();
          for (const owner of owners) {
            const first = await deriveCompanionTreasury(stubClient(), owner);
            const again = await deriveCompanionTreasury(stubClient(), owner);
            expect(first.ok && again.ok).toBe(true);
            if (!first.ok || !again.ok) return;
            // same owner in ⇒ same address out, every time
            expect(again.value).toBe(first.value);
            // different owners ⇒ different addresses
            expect(seen.has(first.value)).toBe(false);
            seen.set(first.value, owner);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('is case-insensitive about the owner: lowercase and checksummed derive the same treasury', async () => {
    const owner = addr('owner-b');
    const a = await deriveCompanionTreasury(stubClient(), owner);
    const b = await deriveCompanionTreasury(stubClient(), owner.toLowerCase() as Address);
    expect(a.ok && b.ok && a.value === b.value).toBe(true);
  });

  it('returns a checksummed address', async () => {
    const r = await deriveCompanionTreasury(stubClient(), addr('owner-c'));
    expect(r.ok && r.value).toBe(r.ok ? getAddress(r.value) : undefined);
  });

  it('fails closed when the RPC throws (I5) — never falls back to the EOA', async () => {
    const broken = createPublicClient({
      chain: baseSepolia,
      transport: custom({
        request: async () => {
          throw new Error('rpc down');
        },
      }),
    }) as unknown as PublicClient;
    const r = await deriveCompanionTreasury(broken, addr('owner-d'));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/could not derive/);
  });
});

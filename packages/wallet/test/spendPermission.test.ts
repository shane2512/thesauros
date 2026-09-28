// Encoder + validation tests for SECURITY §3 Layer 2. The encoders are checked against the vendored
// ABI (itself cross-checked against the CDP SDK in abi.test.ts) and against viem's own typed-data
// hashing, so calldata and the EIP-712 digest cannot drift apart.
import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  encodeFunctionData,
  hashTypedData,
  recoverTypedDataAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { SPEND_PERMISSION_MANAGER_ABI } from '../src/abi';
import {
  buildSpendCall,
  buildSpendPermission,
  encodeApproveWithSignature,
  encodeRevoke,
  encodeRevokeAsSpender,
  encodeSpend,
  parseSpendPermission,
  prepareTypedData,
  serializeSpendPermission,
  spendPermissionDomain,
  spendPermissionHash,
  validateSpendPermission,
  type SpendPermission,
} from '../src/spendPermission';
import { AGENT, ATTACKER, MANAGER, TREASURY, USDC, permission } from './fixtures';

const NOW = 1_800_000_000;
const constraints = {
  ownerAddress: TREASURY,
  agentWalletAddress: AGENT,
  usdcAddress: USDC,
  now: NOW,
};

describe('typed data', () => {
  it('uses the domain verified in V-05', () => {
    expect(spendPermissionDomain(84532, MANAGER)).toEqual({
      name: 'Spend Permission Manager',
      version: '1',
      chainId: 84532,
      verifyingContract: MANAGER,
    });
  });

  it('field order and types match the on-chain struct', () => {
    const td = prepareTypedData(permission, 84532, MANAGER);
    expect(td.types.SpendPermission.map((f) => `${f.name}:${f.type}`)).toEqual([
      'account:address',
      'spender:address',
      'token:address',
      'allowance:uint160',
      'period:uint48',
      'start:uint48',
      'end:uint48',
      'salt:uint256',
      'extraData:bytes',
    ]);
  });

  it('spendPermissionHash equals viem hashTypedData over the same payload', () => {
    expect(spendPermissionHash(permission, 84532, MANAGER)).toBe(
      hashTypedData(prepareTypedData(permission, 84532, MANAGER)),
    );
  });

  it('a different chain or manager yields a different hash (no cross-chain replay)', () => {
    const h = spendPermissionHash(permission, 84532, MANAGER);
    expect(spendPermissionHash(permission, 8453, MANAGER)).not.toBe(h);
    expect(spendPermissionHash(permission, 84532, ATTACKER)).not.toBe(h);
  });

  it('a signature over the typed data recovers to the signer', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const td = prepareTypedData(permission, 84532, MANAGER);
    const signature = await account.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(account.address);
  });
});

describe('encoders match the vendored ABI', () => {
  it.each([
    ['spend', () => encodeSpend(permission, 5n), [permission, 5n]],
    ['revoke', () => encodeRevoke(permission), [permission]],
    ['revokeAsSpender', () => encodeRevokeAsSpender(permission), [permission]],
    [
      'approveWithSignature',
      () => encodeApproveWithSignature(permission, '0xabcd'),
      [permission, '0xabcd'],
    ],
  ])('%s', (name, encode, args) => {
    const data = encode();
    expect(data).toBe(
      encodeFunctionData({
        abi: SPEND_PERMISSION_MANAGER_ABI,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table-driven over 4 functions
        functionName: name as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: args as any,
      }),
    );
    const decoded = decodeFunctionData({ abi: SPEND_PERMISSION_MANAGER_ABI, data });
    expect(decoded.functionName).toBe(name);
  });

  it('round-trips the struct through calldata without losing bigint precision', () => {
    const big: SpendPermission = {
      ...permission,
      allowance: 2n ** 159n - 1n,
      salt: 2n ** 255n - 1n,
    };
    const decoded = decodeFunctionData({
      abi: SPEND_PERMISSION_MANAGER_ABI,
      data: encodeSpend(big, 1n),
    });
    expect(decoded.args[0]).toEqual(big);
  });
});

describe('buildSpendCall', () => {
  it('targets the manager and encodes spend()', () => {
    const r = buildSpendCall(permission, 1_000_000n, MANAGER);
    expect(r.ok && r.value.to).toBe(MANAGER);
    expect(r.ok && r.value.value).toBe(0n);
  });

  it.each([0n, -1n])('rejects amount %s', (amount) => {
    expect(buildSpendCall(permission, amount, MANAGER).ok).toBe(false);
  });

  it('refuses to encode more than the permission allows', () => {
    expect(buildSpendCall(permission, permission.allowance + 1n, MANAGER).ok).toBe(false);
  });
});

describe('JSON round trip (DATA_MODEL spend_permissions.permission)', () => {
  it('serialize → parse is exact for bigints', () => {
    const big: SpendPermission = {
      ...permission,
      allowance: 2n ** 159n - 1n,
      salt: 2n ** 255n - 1n,
    };
    const parsed = parseSpendPermission(JSON.parse(JSON.stringify(serializeSpendPermission(big))));
    expect(parsed.ok && parsed.value).toEqual(big);
  });

  it('rejects unknown fields and non-numeric amounts (fail closed)', () => {
    const json = serializeSpendPermission(permission) as Record<string, unknown>;
    expect(parseSpendPermission({ ...json, extra: 1 }).ok).toBe(false);
    expect(parseSpendPermission({ ...json, allowance: 1.5 }).ok).toBe(false);
    expect(parseSpendPermission({ ...json, allowance: '1e6' }).ok).toBe(false);
    expect(parseSpendPermission({ ...json, account: '0xnothex' }).ok).toBe(false);
  });
});

describe('validateSpendPermission', () => {
  const valid = buildSpendPermission({
    account: TREASURY,
    spender: AGENT,
    token: USDC,
    allowance: 10_000_000n,
    periodSeconds: 86_400,
    start: NOW,
    end: NOW + 86_400,
    salt: 1n,
  });

  it('accepts a well-formed permission', () => {
    expect(validateSpendPermission(valid, constraints).ok).toBe(true);
  });

  const fields = (p: SpendPermission) => {
    const r = validateSpendPermission(p, constraints);
    return r.ok ? [] : r.error.map((i) => i.field);
  };

  it('rejects an account that is not the signed-in owner', () => {
    expect(fields({ ...valid, account: ATTACKER })).toContain('account');
  });

  it('rejects a spender that is not this user’s agent wallet', () => {
    expect(fields({ ...valid, spender: ATTACKER })).toContain('spender');
  });

  it('rejects a non-USDC token', () => {
    expect(fields({ ...valid, token: ATTACKER })).toContain('token');
  });

  it('rejects an allowance above the system ceiling', () => {
    expect(
      fields({
        ...valid,
        allowance: SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD + 1n,
      }),
    ).toContain('allowance');
    expect(fields({ ...valid, allowance: 0n })).toContain('allowance');
  });

  it('rejects periods outside the accepted range', () => {
    expect(fields({ ...valid, period: 60 })).toContain('period');
    expect(fields({ ...valid, period: 400 * 24 * 3600 })).toContain('period');
  });

  it('rejects a start in the past beyond clock skew, and an end in the past', () => {
    expect(fields({ ...valid, start: NOW - 10_000 })).toContain('start');
    expect(fields({ ...valid, start: NOW - 60 })).not.toContain('start'); // skew tolerated
    expect(fields({ ...valid, start: NOW - 20_000, end: NOW - 10_000 })).toContain('end');
  });

  it('rejects an end beyond the one-year horizon and an end before start', () => {
    expect(
      fields({ ...valid, end: NOW + SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_HORIZON_SEC + 10 }),
    ).toContain('end');
    expect(fields({ ...valid, start: NOW + 100, end: NOW + 50 })).toContain('end');
  });

  it('rejects non-empty extraData', () => {
    expect(fields({ ...valid, extraData: '0xdeadbeef' })).toContain('extraData');
  });

  it('reports every problem at once rather than the first', () => {
    const r = validateSpendPermission(
      { ...valid, token: ATTACKER, spender: ATTACKER, allowance: 0n },
      constraints,
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.map((i) => i.field).sort()).toEqual(['allowance', 'spender', 'token']);
  });
});

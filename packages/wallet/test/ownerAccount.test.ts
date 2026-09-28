// D-5 — a plain EOA may not grant a spend permission. The check runs on the prepare/store path.
import { describe, expect, it } from 'vitest';
import type { Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertSmartWalletAccount, prepareTypedData } from '../src/spendPermission';
import { MANAGER, permission } from './fixtures';

const typedData = prepareTypedData(permission, 84532, MANAGER);

/** Minimal fake: `verifyTypedData` is what viem routes through ERC-1271/6492 on a real client. */
const fakeClient = (opts: { valid: boolean | (() => never); code: Hex | undefined }) =>
  ({
    verifyTypedData: async () => {
      if (typeof opts.valid === 'function') opts.valid();
      return opts.valid;
    },
    getCode: async () => opts.code,
  }) as unknown as PublicClient;

const EOA_SIG = `0x${'11'.repeat(65)}` as Hex;
const SIG_6492 =
  `0x${'22'.repeat(200)}6492649264926492649264926492649264926492649264926492649264926492` as Hex;

describe('assertSmartWalletAccount', () => {
  it('accepts a deployed contract wallet (ERC-1271)', async () => {
    const r = await assertSmartWalletAccount(fakeClient({ valid: true, code: '0x6080' }), {
      typedData,
      signature: EOA_SIG,
    });
    expect(r.ok && r.value).toBe('deployed-contract');
  });

  it('accepts a counterfactual smart wallet with an ERC-6492-wrapped signature', async () => {
    const r = await assertSmartWalletAccount(fakeClient({ valid: true, code: '0x' }), {
      typedData,
      signature: SIG_6492,
    });
    expect(r.ok && r.value).toBe('counterfactual-6492');
  });

  it('REJECTS an EOA: valid ECDSA signature, no code, not 6492-wrapped', async () => {
    const r = await assertSmartWalletAccount(fakeClient({ valid: true, code: '0x' }), {
      typedData,
      signature: EOA_SIG,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/plain EOA/);
  });

  it('rejects an invalid signature even for a deployed contract', async () => {
    const r = await assertSmartWalletAccount(fakeClient({ valid: false, code: '0x6080' }), {
      typedData,
      signature: SIG_6492,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/invalid signature/);
  });

  it('fails closed when the RPC throws (I5)', async () => {
    const throwing = fakeClient({
      valid: () => {
        throw new Error('rpc down');
      },
      code: '0x6080',
    });
    const r = await assertSmartWalletAccount(throwing, { typedData, signature: SIG_6492 });
    expect(r.ok).toBe(false);
  });

  it('a real EOA signature over this permission is well-formed but still rejected', async () => {
    // Proves the rejection is about the *account shape*, not a malformed signature.
    const account = privateKeyToAccount(`0x${'33'.repeat(32)}`);
    const signature = await account.signTypedData(typedData);
    expect(signature).toHaveLength(132); // 65-byte ECDSA
    const r = await assertSmartWalletAccount(fakeClient({ valid: true, code: undefined }), {
      typedData,
      signature,
    });
    expect(r.ok).toBe(false);
  });
});

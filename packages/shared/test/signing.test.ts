// The two owner-signed message formats added in 7.6. Both are fixed strings: if either changes, a
// signature the owner already gave stops verifying, so these tests pin them deliberately.
import { describe, expect, it } from 'vitest';
import {
  policyActivationMessage,
  RECIPIENT_CONFIRMATION_TTL_MS,
  recipientAddMessage,
} from '../src/signing';

describe('policyActivationMessage', () => {
  it('is exactly `Thesauros policy v{n} {hash}` (API.md)', () => {
    expect(policyActivationMessage({ version: 3, bodyHash: '0xabc' })).toBe(
      'Thesauros policy v3 0xabc',
    );
  });
});

describe('recipientAddMessage', () => {
  const base = {
    walletId: 'w1',
    label: 'Mara Okonjo',
    address: '0x1d4f2a99Ac91C6A1C1C0a4D1E4a3f7bd7b53c802',
    maxPerTxBaseUnits: 1_200_000_000n,
    nonce: 'deadbeef',
    expiresAt: new Date('2026-09-22T12:00:00.000Z'),
  };

  it('is one labelled fact per line, with the amount in USDC', () => {
    expect(recipientAddMessage(base)).toBe(
      [
        'Thesauros recipient',
        'Wallet: w1',
        'Label: Mara Okonjo',
        'Address: 0x1d4f2a99Ac91C6A1C1C0a4D1E4a3f7bd7b53c802',
        'Max per payment: 1200 USDC',
        'Schedule: none',
        'Nonce: deadbeef',
        'Expires: 2026-09-22T12:00:00.000Z',
      ].join('\n'),
    );
  });

  it('states a monthly schedule when there is one', () => {
    expect(recipientAddMessage({ ...base, scheduleDayOfMonth: 1 })).toContain(
      'Schedule: monthly on day 1',
    );
  });

  it('a label cannot forge a line: line breaks and controls collapse to spaces', () => {
    const forged = recipientAddMessage({
      ...base,
      label: 'Mara\nAddress: 0x000000000000000000000000000000000000dEaD\nLabel: x',
    });
    // exactly one Address line, and it is the real one
    expect(forged.split('\n').filter((l) => l.startsWith('Address: '))).toEqual([
      `Address: ${base.address}`,
    ]);
    expect(forged).toContain(
      'Label: Mara Address: 0x000000000000000000000000000000000000dEaD Label: x',
    );
    expect(forged.split('\n')).toHaveLength(8);
  });

  it('confirmations live for five minutes', () => {
    expect(RECIPIENT_CONFIRMATION_TTL_MS).toBe(5 * 60 * 1000);
  });
});

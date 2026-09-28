// The owner-signed messages that are not approvals (task 7.6). `approval.ts` holds SECURITY §5's
// approval message; these two are its siblings, in the same fixed, human-readable style, so a wallet
// shows the owner plain sentences and a phishing site cannot obtain a signature Thesauros would accept
// for something else.
//
// One definition each, used by the route that BUILDS the message and by the route that VERIFIES the
// signature, so the two can never drift. Neither is exported from `@thesauros/shared/client`: the
// browser must never be able to compose one.
import { formatUnits, USDC_DECIMALS } from './money';

/** API.md: `Thesauros policy v{n} {hash}`, verbatim.
 *
 * Replay is prevented by the version, not by a nonce: `policies.version` is a primary-key component
 * and only one row per wallet may be `active`, so a signature for v2 cannot activate anything twice,
 * and `hash` pins the exact body (treasury address included) that the version will hold.
 */
export function policyActivationMessage(input: { version: number; bodyHash: string }): string {
  return `Thesauros policy v${input.version} ${input.bodyHash}`;
}

/** Recipient confirmations are single-use and short-lived (API.md: server nonce, TTL 5 min). */
export const RECIPIENT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type RecipientMessageInput = {
  walletId: string;
  label: string;
  /** Checksummed by the caller. I4: the allowlist is matched on exactly this string. */
  address: string;
  maxPerTxBaseUnits: bigint;
  scheduleDayOfMonth?: number | undefined;
  nonce: string;
  expiresAt: Date;
};

/**
 * `Thesauros recipient` + one labelled line per fact the owner is agreeing to.
 *
 * The label is owner-supplied text, so every line-breaking character is stripped before it is
 * placed in the message: otherwise a label containing a newline could forge an `Address:` line and
 * the owner would read a different address from the one being added (T3, address poisoning).
 */
export function recipientAddMessage(input: RecipientMessageInput): string {
  return [
    'Thesauros recipient',
    `Wallet: ${input.walletId}`,
    `Label: ${oneLine(input.label)}`,
    `Address: ${input.address}`,
    `Max per payment: ${formatUnits(input.maxPerTxBaseUnits, USDC_DECIMALS)} USDC`,
    `Schedule: ${
      input.scheduleDayOfMonth === undefined ? 'none' : `monthly on day ${input.scheduleDayOfMonth}`
    }`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}

/** Owner-path confirmations (freeze / unfreeze / sweep) are single-use and short-lived. */
export const FREEZE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

/**
 * 8.2 added `sweep`: a sweep is a real on-chain transaction that closes yield positions and burns
 * gas, so a stolen session must not be able to force one either — even though its destination is
 * fixed to the owner's own treasury by the signed policy.
 */
export type FreezeAction = 'freeze' | 'unfreeze' | 'sweep';

/**
 * `Thesauros freeze` / `Thesauros unfreeze` / `Thesauros sweep` + wallet + nonce + expiry (7.8, 8.2).
 *
 * SECURITY §5 fixes only the approval format, so this follows the same shape as the recipient
 * message (D-80): one labelled fact per line, nothing owner-supplied in it, server-issued nonce.
 * The ACTION is part of the first line, so a signature collected for an unfreeze can never be
 * replayed as a freeze or the other way round.
 */
export function freezeMessage(input: {
  action: FreezeAction;
  walletId: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return [
    `Thesauros ${input.action}`,
    `Wallet: ${input.walletId}`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}

/** Collapse anything that could break the one-fact-per-line structure into single spaces. */
function oneLine(s: string): string {
  // Written by code point rather than as a regex class so the set is unambiguous: every C0 control,
  // DEL, and the two Unicode line/paragraph separators become a space.
  const out = Array.from(s, (ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 ? ' ' : ch;
  }).join('');
  return out.replace(/ {2,}/g, ' ').trim();
}

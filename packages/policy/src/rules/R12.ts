// R12 — price freshness and depeg. A quote older than the ceiling (or stamped in the future,
// which means somebody's clock is wrong) is a DENY: stale data must never become an ALLOW (I5).
//
// The depeg check applies to every kind that SIZES a decision from the price — which is all of
// them except the safety exits. That is wider than "inflows only", deliberately: every limit in
// this engine is denominated in micro-USD, so a price far from $1 does not merely mean the token
// is wobbling, it means the per-tx, daily and approval-threshold caps are being computed from a
// number we do not believe. Under a 1 micro-USD quote, 50,000 USDC would read as $0.05 and slide
// under every cap. `risk_exit` and `sweep_home` are exempt because they are the RESPONSE to a
// depeg (and neither is sized from the price: they move the whole position home).
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { depegBps, priceOf, quoteAgeSeconds, usdcToken } from '../units';
import { deny, pass, type Rule } from './kit';

const DEPEG_EXEMPT = ['risk_exit', 'sweep_home', 'noop'] as const;

export const R12: Rule = (input) => {
  if (input.proposal.kind === 'noop') return pass('R12', 'noop needs no price');

  const token = usdcToken(input.policy);
  if (!token) return deny('R12', 'policy has no USDC token');
  const price = priceOf(input, token.address);
  if (!price.ok) return deny('R12', price.error);
  const { quote, demoFallback } = price.value;

  const age = quoteAgeSeconds(quote, input.now);
  if (age < 0) return deny('R12', `price for ${token.symbol} is stamped ${-age}s in the future`);
  if (age > SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC)
    return deny(
      'R12',
      `price for ${token.symbol} is ${age}s old (max ${SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC}s)`,
    );

  if (!DEPEG_EXEMPT.some((k) => k === input.proposal.kind)) {
    const off = depegBps(quote);
    if (off > BigInt(input.policy.depegThresholdBps))
      return deny(
        'R12',
        `${token.symbol} is ${off} bps off $1.00, over the depeg threshold ${input.policy.depegThresholdBps}`,
      );
  }
  return pass(
    'R12',
    `price is ${age}s old and within the depeg threshold${demoFallback ? ' (DEMO parity fallback)' : ''}`,
  );
};

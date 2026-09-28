// 5.6 — the execution error taxonomy.
//
// Two classes, and the difference is whether retrying could possibly be safe:
//   Retryable — the operation was refused before it entered the network (transport failure,
//               paymaster/sponsorship rejection, rate limit). Backoff 1/2/4/8 minutes, at most 4
//               attempts, ALWAYS on the same execution row (same idempotency key, I10).
//   Fatal     — a revert, a simulation/parity mismatch, a rejected receipt, a frozen wallet.
//               FAILED, no retry, breaker counter +1. A new attempt needs a new simulation and a
//               new verdict (PHASES "Do not").
//
// The third possibility is the honest one the spec calls UNCERTAIN: we sent something and do not
// know what happened. That is NOT an error class here — it is an execution *status* (`timeout`)
// handled by the confirmer, because the one thing we must never do is retry it.
//
// Nothing in this file swallows an error: `classifyError` only labels, the caller decides.

export type ErrorClass = 'retryable' | 'fatal';

/** Backoff before attempt 2, 3, 4 and 5 — SECURITY §8 "Gas spike / congestion". */
export const RETRY_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000] as const;
/** Total send attempts, including the first. */
export const MAX_SEND_ATTEMPTS = 4;

export type ExecErrorCode =
  | 'RECEIPT_INVALID'
  | 'NONCE_REPLAYED'
  | 'BUILD_FAILED'
  | 'CALLS_MISMATCH'
  | 'FROZEN'
  | 'BREAKER_OPEN'
  | 'DB_UNAVAILABLE'
  | 'AUDIT_FAILED'
  | 'SEND_FAILED'
  | 'SPONSORSHIP'
  | 'NETWORK';

export type ExecError = {
  code: ExecErrorCode;
  message: string;
  class: ErrorClass;
};

const FATAL_CODES: ReadonlySet<ExecErrorCode> = new Set([
  'RECEIPT_INVALID',
  'NONCE_REPLAYED',
  'BUILD_FAILED',
  'CALLS_MISMATCH',
  'FROZEN',
  'BREAKER_OPEN',
]);

export const execError = (code: ExecErrorCode, message: string, cls?: ErrorClass): ExecError => ({
  code,
  message,
  class: cls ?? (FATAL_CODES.has(code) ? 'fatal' : 'retryable'),
});

/**
 * Classify a thrown send failure.
 *
 * Fail closed in the direction that cannot lose money: anything that looks like a revert, a
 * rejection of the calldata, or an on-chain failure is FATAL (retrying a revert just burns the
 * next attempt). Only clearly pre-network failures are retryable.
 */
export function classifyError(error: unknown): ExecError {
  const message = error instanceof Error ? error.message : String(error);
  const m = message.toLowerCase();

  if (
    /revert|execution failed|out of gas|insufficient (funds|balance|allowance)|nonce too low/.test(
      m,
    )
  )
    return execError('SEND_FAILED', message, 'fatal');
  if (/paymaster|sponsor|gas policy|rejected by policy/.test(m))
    return execError('SPONSORSHIP', message, 'retryable');
  if (
    /timeout|timed out|socket|econn|enotfound|eai_again|network|fetch failed|502|503|504|429|rate limit/.test(
      m,
    )
  )
    return execError('NETWORK', message, 'retryable');
  // Unknown failures are retried once or twice rather than treated as final — but only when no
  // hash was produced (the executor enforces that), so this can never double-send.
  return execError('SEND_FAILED', message, 'retryable');
}

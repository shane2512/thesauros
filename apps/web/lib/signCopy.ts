// Plain-language copy for every way a signing flow can end (say what happened, whether money
// moved, and what to do next). The server owns the truth about why a signature was refused; this
// table only translates its error CODE into a sentence — a code we don't recognise still gets the
// server's own message, never an invented reason.
import { ApiError } from './api';

export type SignError = { title: string; body: string; retryable: boolean };

const REJECTED: SignError = {
  title: 'Signature not given',
  body: 'You closed the wallet request. Nothing was signed and nothing moved. You can try again when you are ready.',
  retryable: true,
};

const CODES: Record<string, SignError> = {
  unauthorized: {
    title: 'You are signed out',
    body: 'Your session ended before this was submitted. Nothing was recorded. Sign in again and repeat the step.',
    retryable: false,
  },
  network: {
    title: 'Thesauros could not reach the server',
    body: 'Nothing was sent and nothing moved. Check your connection and try again.',
    retryable: true,
  },
  bad_response: {
    title: 'Thesauros sent something unexpected',
    body: 'Nothing was recorded on this attempt. Try again in a moment.',
    retryable: true,
  },
  already_frozen: {
    title: 'Thesauros is already stopped',
    body: 'Nothing further was needed, so no signature was taken.',
    retryable: false,
  },
  nothing_to_sweep: {
    title: 'There is nothing to bring home',
    body: 'The agent wallet holds no USDC. Nothing moved because there was nothing to move.',
    retryable: false,
  },
  expired: {
    title: 'This approval expired',
    body: 'Thesauros only holds an approval open for 24 hours, then it lapses on its own. Nothing was done.',
    retryable: false,
  },
  not_pending: {
    title: 'This was already decided',
    body: 'Someone approved or rejected this already, so a second decision was refused. Nothing changed.',
    retryable: false,
  },
  duplicate_recipient: {
    title: 'That address is already on your list',
    body: 'Nothing was added. Thesauros already pays this address under an existing name.',
    retryable: false,
  },
};

/** Map anything a signing flow can throw to honest copy. Wallet rejection is not an error state. */
export function signErrorCopy(e: unknown): SignError {
  if (e instanceof ApiError) {
    const known = CODES[e.code];
    if (known) return known;
    return {
      title: 'Thesauros refused this',
      body: `${e.message} Nothing was recorded.`,
      retryable: e.status >= 500,
    };
  }
  if (isUserRejection(e)) return REJECTED;
  return {
    title: 'That did not go through',
    body: 'Thesauros did not record anything and nothing moved. Try again.',
    retryable: true,
  };
}

/** EIP-1193 user-rejection: code 4001, thrown when the owner closes the wallet's own prompt. */
function isUserRejection(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 4001
  );
}

// Sign-in message format, in the same one-fact-per-line style as `@thesauros/shared`'s
// policy/recipient/freeze messages (SECURITY §5). Domain is bound to the request's own Host header
// (never `req.url`) so a signature collected behind a different reverse-proxy name can't be replayed
// here (API.md).
export const SIGNIN_TTL_MS = 5 * 60 * 1000;

export function signInMessage(input: {
  domain: string;
  address: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return [
    'Thesauros sign-in',
    `Domain: ${input.domain}`,
    `Address: ${input.address}`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}

/** The Host header, never `req.url` (a reverse proxy rewrites the latter but not the former). */
export function domainFromRequest(req: Request): string {
  const host = req.headers.get('host');
  if (!host) throw new Error('request has no Host header');
  return host;
}

import { pino, type DestinationStream, type LoggerOptions } from 'pino';

// SECURITY §6 redaction paths (+ nested headers). I9: secrets are never logged.
//
// pino matches a path by EXACT key name, so `*.secret` does not cover `apiKeySecret`. Task 8.3
// therefore lists every secret-shaped key this codebase actually constructs — the AgentKit config
// object is literally `{ apiKeyId, apiKeySecret, walletSecret }`, and `DATABASE_URL` carries the
// Postgres password in its userinfo even though it is not a `Secret` (D-103).
//
// `token` is deliberately NOT here: in Thesauros it means an ERC-20 address, which is public and is
// the single most useful field in an execution log line.
const SECRET_KEYS = [
  'apiKey',
  'apiKeySecret',
  'entitySecret',
  'walletSecret',
  'sessionSecret',
  'secret',
  'signature',
  'privateKey',
  'mnemonic',
  'password',
  'receiptKey',
  'authorization',
  'cookie',
  'DATABASE_URL',
  'databaseUrl',
];

export const REDACT_PATHS = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((k) => `*.${k}`),
  '*.headers.authorization',
  '*.headers.cookie',
];

export function createLogger(name: string, stream?: DestinationStream, opts: LoggerOptions = {}) {
  const options: LoggerOptions = {
    name,
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...opts,
  };
  return stream ? pino(options, stream) : pino(options);
}

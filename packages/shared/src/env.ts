import { z } from 'zod';
import { err, ok, type Result } from './result';

/** Wrapper that never leaks its value via toString/JSON/inspect. Use reveal() at the single point of use. */
export class Secret<T = string> {
  readonly #value: T;
  constructor(value: T) {
    this.#value = value;
  }
  reveal(): T {
    return this.#value;
  }
  toString(): string {
    return '[REDACTED]';
  }
  toJSON(): string {
    return '[REDACTED]';
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED]';
  }
}

const secret = (min = 1) =>
  z
    .string()
    .min(min)
    .transform((v) => new Secret(v));
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  // Arc testnet (5042002) / mainnet (5042) — docs/VERIFY.md rows 1 and 13.
  CHAIN_ID: z
    .enum(['5042002', '5042'])
    .default('5042002')
    .transform((v) => Number(v)),
  RPC_URL_BASE_SEPOLIA: z.string().url().default('https://sepolia.base.org'),
  SESSION_SECRET: secret(32),
  RECEIPT_HMAC_SECRET: secret(32).optional(), // required from Phase 3/5
  CDP_API_KEY_ID: z.string().min(1).optional(),
  CDP_API_KEY_SECRET: secret().optional(),
  CDP_WALLET_SECRET: secret().optional(),
  CDP_PAYMASTER_URL: z.string().url().optional(),
  SERV_API_KEY: secret().optional(),
  SERV_BASE_URL: z.string().url().default('https://inference-api.openserv.ai/v1'),
  SERV_MODEL_PROPOSER: z.string().default('gpt-5.4-mini'),
  SERV_MODEL_VERIFIER: z.string().default('gpt-5.4-mini'),
  // Arc's USDC precompile — same address on testnet and mainnet (docs/VERIFY.md row 3). Note the
  // dual-decimals gotcha: Arc's native gas asset uses 18 decimals, but this ERC-20 interface is 6.
  USDC_ADDRESS: address.default('0x3600000000000000000000000000000000000000'),
  SPEND_PERMISSION_MANAGER_ADDRESS: address.default('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'),
  MOCK_VAULT_ADDRESS: address.optional(),
  // Phase 5: the I11 demo price source (docs/addresses.md). Optional: absent means no oracle, which
  // the Policy Engine treats as a DENY (R12) unless the fenced demo parity applies.
  MOCK_PRICE_FEED_ADDRESS: address.optional(),
  DEMO_MODE: bool.default(false),
  THESAUROS_ALLOW_MAINNET: bool.default(false),
  TELEGRAM_BOT_TOKEN: secret().optional(),
});

export type Env = z.infer<typeof schema>;

/** Parse once at process start; fail closed on missing/invalid vars and on I8/I11 violations. */
export function parseEnv(source: Record<string, string | undefined>): Result<Env, string> {
  // Treat empty strings as unset so `FOO=` in .env files behaves like absent.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const env = parsed.data;
  if (env.CHAIN_ID === 5042 && !env.THESAUROS_ALLOW_MAINNET) {
    return err('CHAIN_ID 5042 (Arc mainnet) refused: THESAUROS_ALLOW_MAINNET is not set (I8)');
  }
  if (env.DEMO_MODE && env.CHAIN_ID !== 5042002) {
    return err('DEMO_MODE=true is only allowed on chain 5042002 (Arc testnet, I11)');
  }
  return ok(env);
}

let cached: Env | undefined;
/** Edge helper: parse process.env once, throw at startup if invalid (ops error, not domain error). */
export function getEnv(): Env {
  if (!cached) {
    const r = parseEnv(process.env);
    if (!r.ok) throw new Error(`Invalid environment: ${r.error}`);
    cached = r.value;
  }
  return cached;
}

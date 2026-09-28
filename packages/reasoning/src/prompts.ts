// Prompt loading and assembly. Each task's system prompt lives in `prompts/<name>.md` as plain text
// with a YAML-ish frontmatter header carrying its version, so a wording change is visible in the
// audit trail's `promptVersion` field without needing a second source of truth.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Context } from '@thesauros/context';
import type { Proposal } from '@thesauros/shared';

export const PROMPT_NAMES = [
  'propose',
  'verify',
  'screen',
  'compile',
  'explain',
  'counterparty',
] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export type Prompt = { name: PromptName; version: string; system: string };
export type BuiltPrompt = Prompt & { user: string };

const PROMPTS_DIR = fileURLToPath(new URL('../prompts/', import.meta.url));
const cache = new Map<PromptName, Prompt>();

/** Every task's field allowlist, for readers of the prompt output — not enforced here. */
export const FACT_FIELDS = [
  'id',
  'value',
  'unit',
  'source',
  'ageSec',
  'periodEnds',
  'items',
] as const;
export const VAULT_FIELDS = ['id', 'name', 'positionBaseUnits', 'apyPct', 'flagged'] as const;
export const RECIPIENT_FIELDS = ['id', 'label', 'scheduleDayOfMonth'] as const;
export const CONTEXT_FIELDS = [
  'facts',
  'policySummary',
  'allowedKinds',
  'vaults',
  'recipients',
  'untrusted',
] as const;

/** Parses the `---\nkey: value\n---` header `prompts/*.md` files start with. No YAML dependency. */
function parseFrontmatter(raw: string): { version: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return { version: '0', body: raw.trim() };
  const [, header, body] = match;
  const versionLine = /version:\s*(\S+)/.exec(header ?? '');
  return { version: versionLine?.[1] ?? '0', body: (body ?? '').trim() };
}

export function loadPrompt(name: PromptName): Prompt {
  const cached = cache.get(name);
  if (cached) return cached;
  const raw = readFileSync(`${PROMPTS_DIR}${name}.md`, 'utf8');
  const { version, body } = parseFrontmatter(raw);
  const prompt: Prompt = { name, version, system: body };
  cache.set(name, prompt);
  return prompt;
}

export function promptVersions(): Record<PromptName, string> {
  return Object.fromEntries(PROMPT_NAMES.map((n) => [n, loadPrompt(n).version])) as Record<
    PromptName,
    string
  >;
}

const bigintToString = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** The context, minus `baseUnits` (I4: the model reasons over facts, not raw ledger numbers). */
export function contextPayload(ctx: Context): string {
  const { facts, ...rest } = ctx;
  const publicFacts = facts.map((f) => {
    const { baseUnits, ...rest } = f;
    void baseUnits;
    return rest;
  });
  return JSON.stringify({ ...rest, facts: publicFacts }, bigintToString);
}

/** Visually fences third-party text so it reads as data, never as an instruction (RR-7). */
export function fenceUntrusted(items: readonly { id: string; text: string }[]): string {
  if (items.length === 0) return '(none)';
  return items.map((i) => `<untrusted_data id="${i.id}">\n${i.text}\n</untrusted_data>`).join('\n');
}

function build(name: PromptName, user: string): BuiltPrompt {
  const prompt = loadPrompt(name);
  return { ...prompt, user };
}

export function buildProposerPrompt(ctx: Context): BuiltPrompt {
  return build(
    'propose',
    [
      `allowedKinds: ${JSON.stringify(ctx.allowedKinds)}`,
      `context: ${contextPayload(ctx)}`,
      `untrusted:\n${fenceUntrusted(ctx.untrusted)}`,
    ].join('\n\n'),
  );
}

export function buildVerifierPrompt(input: { ctx: Context; proposal: Proposal }): BuiltPrompt {
  return build(
    'verify',
    [
      `context: ${contextPayload(input.ctx)}`,
      `proposal: ${JSON.stringify(input.proposal, bigintToString)}`,
    ].join('\n\n'),
  );
}

export function buildScreenPrompt(items: readonly { id: string; text: string }[]): BuiltPrompt {
  return build('screen', fenceUntrusted(items));
}

export function buildCompilerPrompt(input: {
  mandateText: string;
  vaults: readonly { id: string; name: string }[];
  recipients: readonly { id: string; label: string }[];
  ceilings: Record<string, string | number>;
  allowedKinds: readonly string[];
}): BuiltPrompt {
  return build(
    'compile',
    [
      `mandate: ${input.mandateText}`,
      `vaults: ${JSON.stringify(input.vaults)}`,
      `recipients: ${JSON.stringify(input.recipients)}`,
      `ceilings: ${JSON.stringify(input.ceilings)}`,
      `allowedKinds: ${JSON.stringify(input.allowedKinds)}`,
    ].join('\n\n'),
  );
}

export function buildExplainPrompt(input: {
  decision: string;
  sentences: readonly string[];
  deterministic: string;
}): BuiltPrompt {
  return build(
    'explain',
    [
      `decision: ${input.decision}`,
      `sentences: ${JSON.stringify(input.sentences)}`,
      `deterministic: ${input.deterministic}`,
    ].join('\n\n'),
  );
}

export function buildCounterpartyScreenPrompt(input: {
  label: string;
  address: string;
  chainId: number;
  previousTier?: 'low' | 'medium' | 'high';
  /** Whatever deterministic facts were gathered about this counterparty — never freeform trust. */
  signals: readonly string[];
}): BuiltPrompt {
  return build(
    'counterparty',
    [
      `label: ${input.label}`,
      `address: ${input.address}`,
      `chainId: ${input.chainId}`,
      `previousTier: ${input.previousTier ?? 'unknown'}`,
      `signals: ${JSON.stringify(input.signals)}`,
    ].join('\n\n'),
  );
}

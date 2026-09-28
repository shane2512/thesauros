// The transport boundary between our schema-validated task functions (propose/verify/screen/
// compile/explain) and whichever model actually answers `ServClient.call`. Nothing above this file
// knows or cares which provider that is (I3: reasoning has no tools, and this file is not one
// either — it only turns text back into a typed, schema-checked value or a fail-closed error).
//
// One repair retry, never more: a model that cannot produce valid JSON twice in a row is treated as
// down for this task, and the caller's own fallback (NOOP, UNSURE, deterministic text) takes over.
import type { z } from 'zod';
import { err, ok, type Result } from '@thesauros/shared';
import type { ServClient, ServRequest, ServTask } from './serv/client';
import { requestHash } from './serv/client';
import type { BuiltPrompt } from './prompts';

export type ReasoningErrorCode = 'SERV_ERROR' | 'PARSE_ERROR';
export type ReasoningError = { code: ReasoningErrorCode; message: string };

export type CallMeta = {
  requestIds: string[];
  model: string;
  promptVersion: string;
  /** True when the first answer did not parse and a second attempt was made. */
  repaired: boolean;
  /** Every raw answer text received, in order — fed to the address/ENS scan in `mapProposal`. */
  raw: string[];
};

export type CallSuccess<T> = { value: T; meta: CallMeta };
export type CallFailure = { error: ReasoningError; meta?: CallMeta };

export type CallJsonArgs<T> = {
  client: ServClient;
  task: ServTask;
  model: string;
  prompt: BuiltPrompt;
  schema: { name: string; schema: Record<string, unknown> };
  parser: z.ZodType<T>;
};

/** `JSON.parse`, tolerant of a ```json fence or leading/trailing prose around the object. */
export function extractJson(text: string): Result<unknown, string> {
  const trimmed = text.trim();
  try {
    return ok(JSON.parse(trimmed) as unknown);
  } catch {
    /* fall through to the fenced/embedded forms */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return ok(JSON.parse(fenced[1].trim()) as unknown);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return ok(JSON.parse(trimmed.slice(start, end + 1)) as unknown);
    } catch {
      /* give up below */
    }
  }
  return err(`no JSON object found in the model's answer`);
}

function requestFor(
  args: Pick<CallJsonArgs<unknown>, 'task' | 'model' | 'prompt' | 'schema'>,
): ServRequest {
  const base = {
    task: args.task,
    model: args.model,
    system: args.prompt.system,
    user: args.prompt.user,
    schemaName: args.schema.name,
    jsonSchema: args.schema.schema,
  };
  return { ...base, requestHash: requestHash(base) };
}

function parse<T>(parser: z.ZodType<T>, text: string): Result<T, string> {
  const extracted = extractJson(text);
  if (!extracted.ok) return extracted;
  const parsed = parser.safeParse(extracted.value);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'schema mismatch');
  return ok(parsed.data);
}

/**
 * Call the model once, validate the answer against `schema`/`parser`, and retry exactly once if it
 * does not parse. Fails closed: a transport error, an unparseable answer twice in a row, or a
 * schema mismatch all come back as `Err`, never as a best-effort guess.
 */
export async function callJson<T>(
  args: CallJsonArgs<T>,
): Promise<Result<CallSuccess<T>, CallFailure>> {
  const request = requestFor(args);
  const promptVersion = args.prompt.version;

  const first = await args.client.call(request);
  if (!first.ok) {
    return err({
      error: { code: 'SERV_ERROR', message: first.error.message },
      meta: { requestIds: [], model: args.model, promptVersion, repaired: false, raw: [] },
    });
  }
  const raw = [first.value.text];
  const firstParsed = parse(args.parser, first.value.text);
  if (firstParsed.ok) {
    return ok({
      value: firstParsed.value,
      meta: {
        requestIds: [first.value.requestId],
        model: first.value.model,
        promptVersion,
        repaired: false,
        raw,
      },
    });
  }

  const second = await args.client.call(request);
  if (!second.ok) {
    return err({
      error: { code: 'SERV_ERROR', message: second.error.message },
      meta: {
        requestIds: [first.value.requestId],
        model: args.model,
        promptVersion,
        repaired: true,
        raw,
      },
    });
  }
  raw.push(second.value.text);
  const requestIds = [first.value.requestId, second.value.requestId];
  const secondParsed = parse(args.parser, second.value.text);
  if (secondParsed.ok) {
    return ok({
      value: secondParsed.value,
      meta: { requestIds, model: second.value.model, promptVersion, repaired: true, raw },
    });
  }
  return err({
    error: {
      code: 'PARSE_ERROR',
      message: `model output did not match "${args.schema.name}" after one repair attempt: ${secondParsed.error}`,
    },
    meta: { requestIds, model: args.model, promptVersion, repaired: true, raw },
  });
}

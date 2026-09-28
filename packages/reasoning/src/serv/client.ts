// The one place a real network call to the reasoning provider is made. `LiveServClient` talks to
// OpenServ's OpenAI-compatible `/chat/completions` endpoint (docs/VERIFY.md row 12 — verified live
// in Phase 3: a real key against `inference-api.openserv.ai/v1` returns real models, including the
// `gpt-5.4-mini` this package already defaulted to). Every task function above this file
// (propose/verify/screen/compile/explain) already fails closed on a client error, so a worker whose
// key is missing or whose call fails degrades to deterministic-only behaviour instead of crashing
// (I5) — this file's only job is to turn one HTTP call into a `ServResponse` or a `ServError`.
//
// `FixtureServClient` is the offline double used by tests: it answers from a scripted map (unit
// tests) or from previously recorded fixtures keyed by `requestHash` (golden replay), and never
// touches the network either.
import { createHash } from 'node:crypto';
import { err, ok, type Result, type Secret } from '@thesauros/shared';

export const SERV_TASKS = [
  'propose',
  'verify',
  'screen',
  'compile',
  'explain',
  'counterparty',
] as const;
export type ServTask = (typeof SERV_TASKS)[number];

export type ServUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type ServRequestBase = {
  task: ServTask;
  model: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
};
export type ServRequest = ServRequestBase & { requestHash: string };

export type ServResponse = {
  text: string;
  requestId: string;
  model: string;
  usage?: ServUsage;
};

export type ServErrorCode = 'UNAVAILABLE' | 'NOT_IMPLEMENTED' | 'TRANSPORT' | 'RATE_LIMIT';
export type ServError = { code: ServErrorCode; message: string };

export type ServLogFields = { task: ServTask; model: string; requestHash: string };

export interface ServClient {
  call(request: ServRequest): Promise<Result<ServResponse, ServError>>;
}

/** Stable across process restarts: the fixture recorder and the golden replay must agree on it. */
export function requestHash(request: ServRequestBase): string {
  const canonical = JSON.stringify({
    task: request.task,
    model: request.model,
    system: request.system,
    user: request.user,
    schemaName: request.schemaName,
  });
  return `0x${createHash('sha256').update(canonical).digest('hex')}`;
}

export type LiveServOptions = { apiKey: Secret<string>; baseURL?: string | undefined };

const DEFAULT_BASE_URL = 'https://inference-api.openserv.ai/v1';

/** Shape of an OpenAI-compatible `/chat/completions` response body — only the fields we read. */
type ChatCompletion = {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export class LiveServClient implements ServClient {
  constructor(private readonly options: LiveServOptions) {}

  async call(request: ServRequest): Promise<Result<ServResponse, ServError>> {
    const baseURL = this.options.baseURL ?? DEFAULT_BASE_URL;
    let res: Response;
    try {
      res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey.reveal()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema },
          },
          max_completion_tokens: 2000,
        }),
      });
    } catch (e) {
      return err({
        code: 'TRANSPORT',
        message: `OpenServ request failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return err({
        code: res.status === 429 ? 'RATE_LIMIT' : 'TRANSPORT',
        message: `OpenServ returned ${res.status}: ${body.slice(0, 500)}`,
      });
    }

    let json: ChatCompletion;
    try {
      json = (await res.json()) as ChatCompletion;
    } catch (e) {
      return err({
        code: 'TRANSPORT',
        message: `OpenServ response was not JSON: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0)
      return err({ code: 'TRANSPORT', message: 'OpenServ returned no message content' });

    return ok({
      text: content,
      requestId: json.id ?? `openserv-${Date.now()}`,
      model: json.model ?? request.model,
      ...(json.usage
        ? {
            usage: {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
            },
          }
        : {}),
    });
  }
}

export type ServFixture = {
  requestHash: string;
  task: ServTask;
  model: string;
  response: ServResponse;
  recordedAt: string;
};

/**
 * Test double: `scripted[task]` (unit tests) wins over a recorded fixture match (golden replay);
 * neither present means "the model is down," the same failure mode `LiveServClient` produces today.
 */
export class FixtureServClient implements ServClient {
  readonly calls: ServRequest[] = [];

  constructor(
    private readonly fixtures: readonly ServFixture[] = [],
    private readonly scripted: Partial<Record<ServTask, string>> = {},
  ) {}

  async call(request: ServRequest): Promise<Result<ServResponse, ServError>> {
    this.calls.push(request);
    const script = this.scripted[request.task];
    if (script !== undefined) {
      return ok({
        text: script,
        requestId: `fixture-${request.task}-${this.calls.length}`,
        model: request.model,
      });
    }
    const found = this.fixtures.find(
      (f) => f.requestHash === request.requestHash && f.task === request.task,
    );
    if (found) return ok(found.response);
    return err({ code: 'UNAVAILABLE', message: `no fixture for task "${request.task}"` });
  }
}

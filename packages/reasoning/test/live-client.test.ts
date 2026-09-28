// LiveServClient against a stubbed `fetch` — no network, but the real openai SDK path, so the
// retry policy, the error taxonomy, the usage logging and the D-4 /models shape are all exercised.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Secret } from '@thesauros/shared';
import { LiveServClient, SERV_SCHEMAS, type ServLogFields, type ServRequest } from '../src/index';

const BASE = 'https://inference-api.example/v1';
const KEY = 'sk-live-FAKE-0123456789abcdef0123456789';

const req: ServRequest = {
  task: 'screen',
  model: 'gpt-5.4-mini',
  system: 'you are a classifier',
  user: 'SECRET-PROMPT-BODY-should-never-be-logged',
  schema: SERV_SCHEMAS.screen,
};

const completion = (content: string) =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl-live',
      model: 'gpt-5.4-mini-2026-03-17',
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const status = (code: number) =>
  new Response(JSON.stringify({ error: { message: 'nope' } }), {
    status: code,
    headers: { 'content-type': 'application/json' },
  });

const client = (log?: (f: ServLogFields) => void) =>
  new LiveServClient({
    apiKey: new Secret(KEY),
    baseURL: BASE,
    backoffMs: 0,
    sleep: () => Promise.resolve(),
    ...(log ? { log } : {}),
  });

afterEach(() => vi.unstubAllGlobals());

describe('LiveServClient', () => {
  it('sends a system message, temperature 0 and strict json_schema (V-01/V-08)', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Promise.resolve(completion('{"suspected":false,"reasons":[]}'));
    });
    const r = await client().complete(req);
    expect(r.ok).toBe(true);
    expect(body['temperature']).toBe(0);
    expect((body['messages'] as { role: string }[])[0]?.role).toBe('system');
    expect(
      (body['response_format'] as { json_schema: { strict: boolean } }).json_schema.strict,
    ).toBe(true);
  });

  it('records the response body id as the SERV request id and the usage', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(completion('{"suspected":false,"reasons":[]}')));
    const r = await client().complete(req);
    expect(r.ok && r.value.requestId).toBe('chatcmpl-live');
    expect(r.ok && r.value.usage?.totalTokens).toBe(15);
  });

  it('logs usage without the prompt body or the api key', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(completion('{"suspected":false,"reasons":[]}')));
    const lines: ServLogFields[] = [];
    await client((f) => lines.push(f)).complete(req);
    const dump = JSON.stringify(lines);
    expect(dump).not.toContain('SECRET-PROMPT-BODY');
    expect(dump).not.toContain(KEY);
    expect(lines[0]?.requestHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('retries once on a 5xx and succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls++;
      return Promise.resolve(
        calls === 1 ? status(503) : completion('{"suspected":true,"reasons":[]}'),
      );
    });
    const r = await client().complete(req);
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
  });

  it('does NOT retry a 4xx', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls++;
      return Promise.resolve(status(400));
    });
    const r = await client().complete(req);
    expect(calls).toBe(1);
    expect(!r.ok && r.error.code).toBe('HTTP');
    expect(!r.ok && r.error.status).toBe(400);
  });

  it('retries a network error and then gives up', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls++;
      return Promise.reject(new Error('ECONNRESET'));
    });
    const r = await client().complete(req);
    expect(calls).toBe(2);
    expect(!r.ok && r.error.code).toBe('NETWORK');
  });

  it('treats an empty completion as an error, never as a NOOP answer', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(completion('   ')));
    const r = await client().complete(req);
    expect(!r.ok && r.error.code).toBe('EMPTY');
  });

  it('listModels reads the non-OpenAI {items:[{modelId}]} shape (D-4)', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ items: [{ modelId: 'gpt-5.4-mini' }, { modelId: 'serv-pro' }] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    const r = await client().listModels();
    expect(r.ok && r.value).toEqual(['gpt-5.4-mini', 'serv-pro']);
  });

  it('listModels fails closed on an unexpected shape or an HTTP error', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 200 })));
    expect((await client().listModels()).ok).toBe(false);
    vi.stubGlobal('fetch', () => Promise.resolve(status(401)));
    const r = await client().listModels();
    expect(!r.ok && r.error.status).toBe(401);
  });
});

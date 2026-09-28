import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@thesauros/shared';
import {
  FixtureServClient,
  extractJson,
  requestHash,
  type ServClient,
  type ServError,
  type ServRequest,
  type ServResponse,
} from '../src/index';
import { callJson } from '../src/call';
import { zServScreen, SERV_SCHEMAS } from '../src/schemas';

const req = (over: Partial<ServRequest> = {}): ServRequest => ({
  task: 'screen',
  model: 'gpt-5.4-mini',
  system: 'sys',
  user: 'usr',
  schema: SERV_SCHEMAS.screen,
  ...over,
});

class Programmable implements ServClient {
  calls = 0;
  constructor(private readonly answers: Result<ServResponse, ServError>[]) {}
  complete(): Promise<Result<ServResponse, ServError>> {
    const a = this.answers[Math.min(this.calls, this.answers.length - 1)];
    this.calls++;
    return Promise.resolve(a ?? err({ code: 'EMPTY', message: 'none' }));
  }
}

const text = (t: string): Result<ServResponse, ServError> =>
  ok({ text: t, requestId: 'chatcmpl-x', model: 'm', latencyMs: 1 });

describe('requestHash', () => {
  it('is stable for the same request and changes with the prompt', () => {
    expect(requestHash(req())).toBe(requestHash(req()));
    expect(requestHash(req({ user: 'other' }))).not.toBe(requestHash(req()));
    expect(requestHash(req({ model: 'other' }))).not.toBe(requestHash(req()));
  });
});

describe('FixtureServClient', () => {
  it('replays by request hash', async () => {
    const c = new FixtureServClient([
      {
        requestHash: requestHash(req()),
        task: 'screen',
        model: 'gpt-5.4-mini',
        response: {
          text: '{"suspected":false,"reasons":[]}',
          requestId: 'chatcmpl-rec',
          model: 'gpt-5.4-mini',
        },
      },
    ]);
    const r = await c.complete(req());
    expect(r.ok && r.value.requestId).toBe('chatcmpl-rec');
  });

  it('fails closed on an unrecorded request instead of calling anything', async () => {
    const r = await new FixtureServClient().complete(req());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('FIXTURE_MISSING');
  });

  it('serves scripted output per task (compromised-model variants)', async () => {
    const c = new FixtureServClient([], { screen: '{"suspected":true,"reasons":["x"]}' });
    const r = await c.complete(req());
    expect(r.ok && r.value.text).toContain('suspected');
  });
});

describe('extractJson', () => {
  it('unwraps fenced JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('fails on prose', () => {
    expect(extractJson('I cannot help with that').ok).toBe(false);
  });
});

describe('callJson repair policy', () => {
  const call = (client: ServClient) =>
    callJson({
      client,
      task: 'screen',
      model: 'm',
      prompt: { system: 's', user: 'u', promptVersion: 1 },
      schema: SERV_SCHEMAS.screen,
      parser: zServScreen,
    });

  it('accepts a valid first answer without repairing', async () => {
    const c = new Programmable([text('{"suspected":true,"reasons":[]}')]);
    const r = await call(c);
    expect(r.ok && r.value.meta.repaired).toBe(false);
    expect(c.calls).toBe(1);
  });

  it('repairs exactly once, then gives up', async () => {
    const c = new Programmable([text('{"nope":1}'), text('{"suspected":false,"reasons":[]}')]);
    const r = await call(c);
    expect(r.ok && r.value.meta.repaired).toBe(true);
    expect(c.calls).toBe(2);
  });

  it('never makes a third call', async () => {
    const c = new Programmable([text('garbage')]);
    const r = await call(c);
    expect(r.ok).toBe(false);
    expect(c.calls).toBe(2);
    expect(!r.ok && r.error.error.code).toBe('INVALID_JSON');
  });

  it('does not try to repair a transport error', async () => {
    const c = new Programmable([err<ServError>({ code: 'TIMEOUT', message: 'slow' })]);
    const r = await call(c);
    expect(c.calls).toBe(1);
    expect(!r.ok && r.error.error.code).toBe('SERV_ERROR');
  });

  it('records the SERV request id of every attempt', async () => {
    const c = new Programmable([text('{"nope":1}'), text('{"suspected":false,"reasons":[]}')]);
    const r = await call(c);
    expect(r.ok && r.value.meta.requestIds).toEqual(['chatcmpl-x', 'chatcmpl-x']);
  });
});

describe('json_schema forcing', () => {
  it('every task schema is strict: additionalProperties false, everything required', () => {
    for (const s of Object.values(SERV_SCHEMAS)) {
      expect(s.schema['additionalProperties']).toBe(false);
      const props = Object.keys(s.schema['properties'] as Record<string, unknown>);
      expect(s.schema['required']).toEqual(expect.arrayContaining(props));
    }
  });

  it('carries no keyword the strict endpoint rejects (pattern/maxLength/…)', () => {
    const banned = [
      'pattern',
      'maxLength',
      'minLength',
      'maxItems',
      'minItems',
      'minimum',
      'maximum',
      '$schema',
    ];
    const seen = JSON.stringify(SERV_SCHEMAS);
    for (const k of banned) expect(seen).not.toContain(`"${k}"`);
  });

  it('never offers the model the sweep_home vocabulary (R03 is owner-only)', () => {
    expect(JSON.stringify(SERV_SCHEMAS.propose)).not.toContain('sweep_home');
  });
});

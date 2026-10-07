// Typed fetch for the Thesauros API. Every response is parsed with a zod schema from contracts.ts,
// so a malformed or unexpected payload becomes a plain-language error instead of a crash.
import type { ZodType } from 'zod';
import { zApiError } from './contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  schema: ZodType<T>,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'Thesauros could not reach the server.');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = zApiError.safeParse(json);
    throw new ApiError(
      res.status,
      e.success ? e.data.error.code : 'error',
      e.success ? e.data.error.message : `The server answered ${res.status}.`,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      res.status,
      'bad_response',
      'Thesauros sent a response the app did not expect.',
    );
  }
  return parsed.data;
}

export const apiGet = <T>(path: string, schema: ZodType<T>) => apiRequest('GET', path, schema);
export const apiPost = <T>(path: string, schema: ZodType<T>, body?: unknown) =>
  apiRequest('POST', path, schema, body);
export const apiPatch = <T>(path: string, schema: ZodType<T>, body?: unknown) =>
  apiRequest('PATCH', path, schema, body);
export const apiDelete = <T>(path: string, schema: ZodType<T>, body?: unknown) =>
  apiRequest('DELETE', path, schema, body);

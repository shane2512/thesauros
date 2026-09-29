import { NextResponse } from 'next/server';

/** {error:{code,message}} — the shape lib/contracts.ts's zApiError parses on the client. */
export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

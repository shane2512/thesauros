import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Landing page. Served as a raw file, bypassing the root layout/React entirely, because the
// source (generated/landing.html) is already a complete standalone <html> document with its own
// scroll-reveal animations — re-authoring it in React kept losing animation fidelity.
const FILE = path.join(process.cwd(), 'generated', 'landing.html');

let cached: string | null = null;

export async function GET() {
  if (cached === null) {
    cached = await readFile(FILE, 'utf-8');
  }
  return new Response(cached, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

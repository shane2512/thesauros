// Save text the page already holds (or a same-origin, owner-authenticated export) as a file.

export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The audit export route validates its own query and shapes its own output, so the raw text is
 * saved as-is rather than re-parsed. */
export async function downloadAudit(format: 'csv' | 'json'): Promise<void> {
  const res = await fetch(`/api/audit/export?format=${format}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  downloadText(
    await res.text(),
    `thesauros-audit.${format}`,
    format === 'json' ? 'application/json' : 'text/csv',
  );
}

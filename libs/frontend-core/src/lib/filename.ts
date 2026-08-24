// ASCII-safe filename for protocol slots that cannot carry UTF-8 or the
// delimiters they use: Chromium's `DownloadURL` drag payload
// ("<mime>:<name>:<url>") and the quoted form of Content-Disposition.
//
// The same rule lives on the backend in `inlineDisposition`
// (apps/backend/src/app/uploads.controller.ts) — the tiers cannot share code,
// so the character class is deliberately identical on both sides: strip
// non-ASCII, neutralise the delimiters, fall back to the attachment id when
// nothing printable survives (e.g. an all-Cyrillic name).
export function asciiFilename(
  filename: string | null | undefined,
  fallback: string,
): string {
  const ascii = (filename ?? '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\";:]/g, '_')
    .trim();
  return ascii.length > 0 ? ascii : fallback;
}

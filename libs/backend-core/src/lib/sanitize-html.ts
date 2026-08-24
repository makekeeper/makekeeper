/**
 * Allowlist HTML sanitizer for user-authored rich text, applied at the write
 * boundary (project / task / component descriptions).
 *
 * The authoritative XSS control is the frontend render-time sanitizer; this is
 * defense-in-depth so a payload cannot rest in the database and reach any other
 * consumer of the field. It runs in Node (no DOM), so it works by rewriting the
 * tag stream: allowlisted tags are re-emitted with every attribute stripped
 * (only a validated `href` on `<a>` survives) and every other tag is dropped.
 * Because attributes are never passed through verbatim, handler attributes
 * (`onerror`, `onload`, ...) can never survive.
 */

// prettier-ignore
const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'h3',
  'ul', 'ol', 'li', 'code', 'pre', 'p', 'br', 'div', 'span', 'blockquote',
]);

const RAW_CONTENT_BLOCK =
  /<(script|style|noscript|iframe|object|embed|template|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi;
const HREF_ATTR = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

function isSafeHref(raw: string): boolean {
  const value = raw.trim();
  // Reject anything a browser could decode into a dangerous scheme: control
  // chars, quote/angle chars that would break out of the attribute, and
  // numeric/entity encodings used to hide "javascript:".
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f"'<>`]/.test(value)) return false;
  if (/&#|&colon;|&tab;|&newline;/i.test(value)) return false;
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    return ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase());
  }
  return true; // relative path or anchor
}

/**
 * Plain text on its way INTO a rich-text field.
 *
 * `sanitizeHtml` reads its input as markup, so text that was never markup loses
 * whatever looks like a tag to it: a model describing a part as "pitch <5mm" or
 * "marked <unreadable>" would have those dropped on the way to the card. Text
 * that a person typed into a `<textarea>` is escaped instead — nothing is
 * removed, and what they wrote is what the card shows.
 */
export function escapeHtmlText(plain: string | null | undefined): string {
  if (!plain) return '';
  return plain
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  const withoutBlocks = dirty
    .replace(RAW_CONTENT_BLOCK, '')
    .replace(HTML_COMMENT, '');

  // prettier-ignore
  return withoutBlocks.replace(TAG, (match, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (match.startsWith('</')) return `</${name}>`;
    if (name === 'a') {
      const href = rawAttrs.match(HREF_ATTR);
      const url = href ? (href[2] ?? href[3] ?? href[4] ?? '') : '';
      return url && isSafeHref(url)
        ? `<a href="${url.replace(/"/g, '&quot;')}">`
        : '<a>';
    }
    return `<${name}>`;
  });
}

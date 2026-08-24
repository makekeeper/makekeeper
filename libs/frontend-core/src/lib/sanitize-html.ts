/**
 * Allowlist HTML sanitizer for user-authored rich text (project / task /
 * component descriptions produced by the RichEditor).
 *
 * These values are rendered with Vue's `v-html`, so any tag or attribute that
 * survives here runs in the *viewer's* authenticated session. Under multi-user
 * scope sharing the viewer can be a different user than the author, which turns
 * an unsanitized description into a cross-user token-theft vector. Everything
 * outside the allowlist is therefore dropped; only the formatting the editor
 * can actually produce is preserved.
 *
 * Parsing happens in an inert `DOMParser` document, which neither executes
 * scripts nor loads resources, so on-event payloads never fire while cleaning.
 */

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'h3',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'p',
  'br',
  'div',
  'span',
  'blockquote',
]);

// Elements whose *content* must never survive: script/style bodies, nested
// browsing contexts, and the SVG/MathML namespaces used for mutation-XSS.
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'template',
  'svg',
  'math',
  'link',
  'meta',
  'title',
  'head',
  'base',
]);

// Whitespace + ASCII control chars, stripped before scheme detection so an
// obfuscated scheme (e.g. a tab inside "javascript:") cannot slip past.
// eslint-disable-next-line no-control-regex
const WHITESPACE_AND_CONTROL = /[\s\u0000-\u001f\u007f]/g;

function isSafeHref(raw: string): boolean {
  const value = raw.replace(WHITESPACE_AND_CONTROL, '').toLowerCase();
  return !(
    value.startsWith('javascript:') ||
    value.startsWith('data:') ||
    value.startsWith('vbscript:')
  );
}

function cleanAttributes(el: Element): void {
  const isAnchor = el.tagName.toLowerCase() === 'a';
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === 'class') continue; // classes cannot execute script
    if (isAnchor && name === 'href' && isSafeHref(attr.value)) continue;
    el.removeAttribute(attr.name);
  }
}

function cleanChildren(parent: Node): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      // Comments and other non-element nodes are removed outright.
      (child as ChildNode).remove();
      continue;
    }

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (DROP_WITH_CONTENT.has(tag)) {
      el.remove();
      continue;
    }

    // Clean the subtree first so unwrapped children are already safe.
    cleanChildren(el);

    if (ALLOWED_TAGS.has(tag)) {
      cleanAttributes(el);
    } else {
      // Unknown element: unwrap, keeping its (now-clean) children.
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
    }
  }
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return '';
  const doc = new DOMParser().parseFromString(dirty, 'text/html');
  cleanChildren(doc.body);
  return doc.body.innerHTML;
}

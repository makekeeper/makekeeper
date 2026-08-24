import { escapeHtmlText, sanitizeHtml } from './sanitize-html';

describe('sanitizeHtml (backend write guard)', () => {
  it('returns empty string for empty/nullish input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('preserves allowlisted formatting tags', () => {
    const rich = '<h3>Title</h3><b>bold</b><ul><li>one</li></ul><code>x</code>';
    expect(sanitizeHtml(rich)).toBe(rich);
  });

  it('keeps a safe anchor but strips its other attributes', () => {
    expect(
      sanitizeHtml('<a href="https://example.com" onclick="x()">l</a>'),
    ).toBe('<a href="https://example.com">l</a>');
  });

  it('drops javascript: and data: hrefs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '<a>x</a>',
    );
    expect(sanitizeHtml('<a href="data:text/html,x">x</a>')).toBe('<a>x</a>');
  });

  it('rejects entity-obfuscated javascript hrefs', () => {
    const out = sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>');
    expect(out).toBe('<a>x</a>');
  });

  it('removes <script> and its body', () => {
    expect(sanitizeHtml('a<script>alert(1)</script>b')).toBe('ab');
  });

  it('drops the img/onerror payload entirely', () => {
    const out = sanitizeHtml('<img src=x onerror="steal()">hi');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
    expect(out).toBe('hi');
  });

  it('strips event handlers from allowed tags', () => {
    expect(sanitizeHtml('<b onmouseover="x()">t</b>')).toBe('<b>t</b>');
  });

  it('drops unknown tags but keeps their text', () => {
    expect(sanitizeHtml('<marquee>hello</marquee>')).toBe('hello');
  });

  it('leaves plain text untouched', () => {
    expect(sanitizeHtml('just a note, no html')).toBe('just a note, no html');
  });
});

describe('escapeHtmlText (plain text entering a rich-text field)', () => {
  it('returns empty string for empty/nullish input', () => {
    expect(escapeHtmlText('')).toBe('');
    expect(escapeHtmlText(null)).toBe('');
    expect(escapeHtmlText(undefined)).toBe('');
  });

  it('keeps measurements the markup sanitizer would have eaten', () => {
    // A mobile-intake description (#206) is written by a model and edited in a
    // textarea — never markup. Run through `sanitizeHtml` it lost both of these.
    expect(sanitizeHtml('pitch <5mm, marked <unreadable>')).not.toContain(
      'unreadable',
    );
    expect(escapeHtmlText('pitch <5mm, marked <unreadable>')).toBe(
      'pitch &lt;5mm, marked &lt;unreadable&gt;',
    );
  });

  it('escapes the ampersand first, so an entity is not double-decoded', () => {
    expect(escapeHtmlText('R&D <note>')).toBe('R&amp;D &lt;note&gt;');
  });

  it('renders inert: an escaped script is text, not a tag', () => {
    const escaped = escapeHtmlText('<script>alert(1)</script>');
    expect(escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    // And survives the write guard unchanged — there is no tag left to strip.
    expect(sanitizeHtml(escaped)).toBe(escaped);
  });
});

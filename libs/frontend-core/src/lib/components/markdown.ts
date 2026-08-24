import { h, type VNode } from 'vue';
import { RouterLink } from 'vue-router';
import { hasObjectRefScheme } from '@makekeeper/plugin-contract';
import { resolveObjectRefRoute } from '../registry';

// A minimal, dependency-free Markdown renderer for assistant chat replies. It emits
// a Vue VNode tree where every piece of model text is a VNode child, so Vue escapes
// it — we never feed model output to v-html, which keeps this immune to HTML/JS
// injection. It covers the subset LLMs actually emit (bold, italic, inline code,
// code fences, headings, bullet/numbered lists, links) and degrades anything else to
// plain text rather than guessing.

type Inline = string | VNode;

// Only these URL schemes may reach an <a href>. Everything else — notably
// javascript: and data: — is dropped so a crafted link can't smuggle a script.
const isSafeHref = (url: string): boolean =>
  /^(https?:\/\/|mailto:|\/|#)/i.test(url.trim());

// Shared style for links (external <a> and internal ORef RouterLinks alike).
const LINK_CLASS = 'text-brand-600 dark:text-brand-400 underline break-all';

// Ordered so the longer/greedier markers win at the same position: inline code and
// bold (**) are tried before italic (*), links before stray brackets. A bare
// canonical ORef ("mk://…") is matched last so an unbracketed reference in a reply
// still becomes a clickable in-app link (#16).
const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))|(mk:\/\/[A-Za-z0-9\-/#%_~]+)/;

// Render an ORef as an in-app RouterLink when its route resolves, else fall back to
// the given plain-text/inline children so an unresolvable ref is never a dead link.
const orefLink = (ref: string, label: Inline[]): Inline => {
  const to = resolveObjectRefRoute(ref);
  if (to) return h(RouterLink, { to, class: LINK_CLASS }, () => label);
  return label.length === 1 ? label[0] : h('span', {}, label);
};

const parseInline = (text: string): Inline[] => {
  const nodes: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(
        h(
          'code',
          {
            class:
              'rounded bg-slate-200/70 dark:bg-white/10 px-1 py-0.5 font-mono text-xs',
          },
          token.slice(1, -1),
        ),
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        h(
          'strong',
          { class: 'font-semibold' },
          parseInline(token.slice(2, -2)),
        ),
      );
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(h('em', {}, parseInline(token.slice(1, -1))));
    } else if (hasObjectRefScheme(token)) {
      // Bare canonical ORef — an in-app link when it resolves, plain text otherwise.
      nodes.push(orefLink(token, [token]));
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link && hasObjectRefScheme(link[2])) {
        // Markdown link whose target is an ORef → in-app RouterLink, label preserved.
        nodes.push(orefLink(link[2].trim(), parseInline(link[1])));
      } else if (link && isSafeHref(link[2])) {
        nodes.push(
          h(
            'a',
            {
              href: link[2].trim(),
              target: '_blank',
              rel: 'noopener noreferrer',
              class: LINK_CLASS,
            },
            parseInline(link[1]),
          ),
        );
      } else {
        // Malformed or unsafe link — show the literal text, never a live link.
        nodes.push(token);
      }
    }
    rest = rest.slice(match.index + token.length);
  }
  return nodes;
};

const HEADING = /^(#{1,6})\s+(.*)$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+\.\s+(.*)$/;
const FENCE = /^```/;

const headingClass = (level: number): string => {
  if (level <= 1) return 'text-base font-bold';
  if (level === 2) return 'text-sm font-bold';
  return 'text-sm font-semibold';
};

const isBlockStart = (line: string): boolean =>
  FENCE.test(line.trim()) ||
  HEADING.test(line) ||
  UL.test(line) ||
  OL.test(line);

export const renderMarkdown = (source: string): VNode[] => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: VNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block — kept verbatim, no inline parsing inside.
    if (FENCE.test(line.trim())) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      blocks.push(
        h(
          'pre',
          {
            class:
              'overflow-x-auto rounded-lg bg-slate-200/60 dark:bg-white/5 p-3 text-xs',
          },
          h('code', { class: 'font-mono' }, code.join('\n')),
        ),
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(
        h(
          'p',
          { class: headingClass(heading[1].length) },
          parseInline(heading[2]),
        ),
      );
      i++;
      continue;
    }

    if (UL.test(line)) {
      const items: VNode[] = [];
      while (i < lines.length) {
        const item = UL.exec(lines[i]);
        if (!item) break;
        items.push(h('li', {}, parseInline(item[1])));
        i++;
      }
      blocks.push(h('ul', { class: 'list-disc pl-5 space-y-1' }, items));
      continue;
    }

    if (OL.test(line)) {
      const items: VNode[] = [];
      while (i < lines.length) {
        const item = OL.exec(lines[i]);
        if (!item) break;
        items.push(h('li', {}, parseInline(item[1])));
        i++;
      }
      blocks.push(h('ol', { class: 'list-decimal pl-5 space-y-1' }, items));
      continue;
    }

    // Paragraph — consecutive plain lines, soft-wrapped with <br>.
    const para: Inline[] = [];
    let first = true;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isBlockStart(lines[i])
    ) {
      if (!first) para.push(h('br'));
      para.push(...parseInline(lines[i]));
      first = false;
      i++;
    }
    blocks.push(h('p', {}, para));
  }

  return blocks;
};

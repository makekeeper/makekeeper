import { describe, it, expect } from 'vitest';
import type { VNode } from 'vue';
import { renderMarkdown } from '@makekeeper/frontend-core';

// Walk the rendered VNode tree and collect every element tag, so tests can assert
// on structure without depending on child ordering details.
const tags = (nodes: VNode[]): string[] => {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object' && node !== null && 'type' in node) {
      const vnode = node as VNode;
      if (typeof vnode.type === 'string') out.push(vnode.type);
      visit(vnode.children);
    }
  };
  nodes.forEach(visit);
  return out;
};

describe('renderMarkdown', () => {
  it('renders bold and italic as <strong>/<em>', () => {
    expect(tags(renderMarkdown('**bold** and *italic*'))).toEqual(
      expect.arrayContaining(['p', 'strong', 'em']),
    );
  });

  it('renders inline code and fenced code blocks', () => {
    expect(tags(renderMarkdown('use `npm test`'))).toContain('code');
    const fenced = tags(renderMarkdown('```\nconst x = 1\n```'));
    expect(fenced).toContain('pre');
    expect(fenced).toContain('code');
  });

  it('renders bullet lists with one <li> per item', () => {
    const nodes = renderMarkdown('* one\n* two\n* three');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('ul');
    expect(tags(nodes).filter((t) => t === 'li')).toHaveLength(3);
  });

  it('renders numbered lists as <ol>', () => {
    const nodes = renderMarkdown('1. first\n2. second');
    expect(nodes[0].type).toBe('ol');
    expect(tags(nodes).filter((t) => t === 'li')).toHaveLength(2);
  });

  it('renders a safe link as an anchor', () => {
    const nodes = renderMarkdown('[docs](https://example.com)');
    expect(tags(nodes)).toContain('a');
  });

  it('never emits a live link for an unsafe (javascript:) URL', () => {
    const nodes = renderMarkdown('[x](javascript:alert(1))');
    expect(tags(nodes)).not.toContain('a');
  });

  it('keeps plain text as a paragraph', () => {
    const nodes = renderMarkdown('just some text');
    expect(nodes[0].type).toBe('p');
  });
});

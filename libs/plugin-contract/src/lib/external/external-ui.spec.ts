import { sanitizeUiNodes, sanitizeUiScreen } from './external-ui';

describe('sanitizeUiNodes', () => {
  it('keeps well-formed nodes', () => {
    const { nodes, dropped } = sanitizeUiNodes([
      { type: 'text', text: { key: 'x.hello' } },
      {
        type: 'button',
        label: { key: 'x.go' },
        onClick: { action: 'go' },
      },
    ]);
    expect(nodes).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('skips unknown node types instead of failing (forward compatibility)', () => {
    const { nodes, dropped } = sanitizeUiNodes([
      { type: 'hologram', text: { key: 'x.future' } },
      { type: 'text', text: { key: 'x.hello' } },
    ]);
    expect(nodes).toHaveLength(1);
    expect(dropped).toEqual(['hologram']);
  });

  it('skips structurally broken nodes of known types', () => {
    const { nodes, dropped } = sanitizeUiNodes([
      // A text node whose text is a raw literal, not an i18n reference — the
      // hardcoded-string back door the vocabulary must keep shut.
      { type: 'text', text: 'raw literal' },
      { type: 'form', fields: [] },
    ]);
    expect(nodes).toHaveLength(0);
    expect(dropped).toEqual(['text', 'form']);
  });

  it('recurses into sections', () => {
    const { nodes, dropped } = sanitizeUiNodes([
      {
        type: 'section',
        title: { key: 'x.section' },
        children: [{ type: 'divider' }, { type: 'mystery' }],
      },
    ]);
    expect(nodes).toHaveLength(1);
    const section = nodes[0];
    expect(section.type).toBe('section');
    if (section.type === 'section') {
      expect(section.children).toHaveLength(1);
    }
    expect(dropped).toEqual(['mystery']);
  });
});

describe('sanitizeUiScreen', () => {
  it('rejects a screen without an i18n title', () => {
    expect(sanitizeUiScreen({ title: 'literal', children: [] })).toBeNull();
  });

  it('passes a valid screen through with its refs', () => {
    const res = sanitizeUiScreen({
      title: { key: 'x.title' },
      children: [{ type: 'divider' }],
      refs: ['mk://weather/city/1', 42],
    });
    expect(res).not.toBeNull();
    expect(res?.screen.children).toHaveLength(1);
    // Non-string refs are silently discarded.
    expect(res?.screen.refs).toEqual(['mk://weather/city/1']);
  });
});

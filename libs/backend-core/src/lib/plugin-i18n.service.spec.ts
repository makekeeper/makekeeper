import { AgentTool, PermissionLevel } from '@makekeeper/plugin-contract';
import { PluginI18nService } from './plugin-i18n.service';

describe('PluginI18nService', () => {
  let i18n: PluginI18nService;

  beforeEach(() => {
    i18n = new PluginI18nService();
    i18n.registerBundle({
      en: {
        demo: {
          greeting: 'Hello, {name}',
          plain: 'Plain text',
          nested: { deep: 'Deep value' },
        },
      },
      ru: {
        demo: {
          greeting: 'Привет, {name}',
          plain: 'Просто текст',
        },
      },
    });
  });

  it('resolves a dotted key to the default locale (en)', () => {
    expect(i18n.t('demo.plain')).toBe('Plain text');
  });

  it('resolves to the requested locale when a bundle exists for it', () => {
    expect(i18n.t('demo.plain', undefined, 'ru')).toBe('Просто текст');
  });

  it('interpolates {name} placeholders', () => {
    expect(i18n.t('demo.greeting', { name: 'Ada' }, 'ru')).toBe('Привет, Ada');
  });

  it('falls back to the default locale when the requested one is unknown', () => {
    // 'de' has no bundle → default 'en'.
    expect(i18n.t('demo.plain', undefined, 'de')).toBe('Plain text');
  });

  it('falls back to the default locale when a key is missing in the requested one', () => {
    // 'demo.nested.deep' exists only in en; a Russian caller still gets it.
    expect(i18n.t('demo.nested.deep', undefined, 'ru')).toBe('Deep value');
  });

  it('returns the raw key when it is missing everywhere', () => {
    expect(i18n.t('demo.unknown.key')).toBe('demo.unknown.key');
  });

  it('has() reports presence without emitting the missing-key warning', () => {
    expect(i18n.has('demo.plain')).toBe(true);
    // Present only in en → truthy for a Russian caller via the default fallback.
    expect(i18n.has('demo.nested.deep', 'ru')).toBe(true);
    expect(i18n.has('demo.unknown.key')).toBe(false);
  });

  it('deep-merges bundles registered separately without clobbering siblings', () => {
    i18n.registerBundle({ en: { demo: { extra: 'Extra' } } });
    expect(i18n.t('demo.extra')).toBe('Extra');
    // The earlier-registered sibling key survives the merge.
    expect(i18n.t('demo.plain')).toBe('Plain text');
  });

  it('resolveTool resolves the tool and parameter description keys', () => {
    const tool: AgentTool = {
      name: 'demo_tool',
      descriptionKey: 'demo.plain',
      permission: PermissionLevel.READ,
      parameters: {
        type: 'object',
        properties: {
          who: { type: 'string', descriptionKey: 'demo.greeting' },
        },
        required: ['who'],
      },
      pluginId: 'demo',
      pluginLabelKey: 'plugins.demo.name',
      handler: async () => null,
    };

    const resolved = i18n.resolveTool(tool, 'ru');
    expect(resolved.name).toBe('demo_tool');
    expect(resolved.description).toBe('Просто текст');
    expect(resolved.parameters.properties.who.description).toBe(
      'Привет, {name}',
    );
    expect(resolved.parameters.required).toEqual(['who']);
  });
});

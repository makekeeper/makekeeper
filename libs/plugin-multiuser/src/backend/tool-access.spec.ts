import { PermissionLevel } from '@makekeeper/plugin-contract';
import { toolIsAccessible } from './tool-access';

// The rule that decides what the assistant may even see. It ran inline in the
// module, untested, and silently withheld every external plugin's tools from
// every user for as long as the overlay was on.

const tool = (over: Partial<Parameters<typeof toolIsAccessible>[0]> = {}) => ({
  pluginId: 'inventory',
  permission: PermissionLevel.READ,
  ...over,
});

describe('multiuser tool access', () => {
  it('filters nothing while the overlay is off', () => {
    expect(toolIsAccessible(tool(), undefined)).toBe(true);
    expect(toolIsAccessible(tool(), {})).toBe(true);
  });

  it('hides a plugin the user turned off', () => {
    const rc = { enabledPluginIds: new Set(['projects']) };
    expect(toolIsAccessible(tool({ pluginId: 'inventory' }), rc)).toBe(false);
    expect(toolIsAccessible(tool({ pluginId: 'projects' }), rc)).toBe(true);
  });

  it('does not hide an external plugin behind the internal plugin set', () => {
    // The per-user set is built from the internal registry, so an external
    // plugin's id can never be in it. Testing membership dropped every
    // external tool — the defect this file exists for.
    const rc = { enabledPluginIds: new Set(['projects']) };
    expect(
      toolIsAccessible(tool({ pluginId: 'telegram', external: true }), rc),
    ).toBe(true);
  });

  it('keeps a READ-shared scope read-only, external tools included', () => {
    const rc = { enabledPluginIds: new Set(['projects']), accessLevel: 'READ' };
    expect(
      toolIsAccessible(
        tool({ pluginId: 'projects', permission: PermissionLevel.WRITE }),
        rc,
      ),
    ).toBe(false);
    expect(
      toolIsAccessible(
        tool({
          pluginId: 'telegram',
          external: true,
          permission: PermissionLevel.WRITE,
        }),
        rc,
      ),
    ).toBe(false);
    // …and reading is still allowed.
    expect(
      toolIsAccessible(tool({ pluginId: 'telegram', external: true }), rc),
    ).toBe(true);
  });
});

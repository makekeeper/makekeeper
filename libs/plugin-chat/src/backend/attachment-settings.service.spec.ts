import { AttachmentSettingsService } from './attachment-settings.service';
import { DEFAULT_ATTACHMENT_RULES } from '@makekeeper/plugin-contract';

// The one rule worth pinning down: the ruleset belongs to whoever owns the
// ACTIVE connection, because that is who pays for whatever the model is fed.
// Everything else here is fallback behaviour — an install with nothing stored,
// or a connection that cannot be resolved at all, must still have rules.

type Row = {
  id: string;
  ownerUserId: string | null;
  mimeTypes: string;
  extensions: string;
  maxNonImageBytes: number;
  maxReadBytes: number;
};

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  ownerUserId: id === 'instance' ? null : id,
  mimeTypes: 'text/*',
  extensions: 'txt',
  maxNonImageBytes: 1024 * 1024,
  maxReadBytes: 4096,
  ...over,
});

// What `ProviderService.resolveActiveRuntime` reports about the connection the
// caller's turns would actually run on.
type ActiveRuntime =
  | { status: 'ready'; ownerUserId: string | null }
  | { status: 'locked'; ownerUserId: string | null }
  | { status: 'none' };

const makeService = (
  rows: Row[],
  active: ActiveRuntime,
): AttachmentSettingsService => {
  const prisma = {
    chatAttachmentSettings: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
    },
  };
  const providers = { resolveActiveRuntime: async () => active };
  return new AttachmentSettingsService(prisma as never, providers as never);
};

describe('AttachmentSettingsService', () => {
  it('uses the ruleset of the active connection owner', async () => {
    const service = makeService(
      [
        row('instance', { extensions: 'log' }),
        row('user-1', { extensions: 'gcode' }),
      ],
      { status: 'ready', ownerUserId: 'user-1' },
    );
    const effective = await service.resolveEffective();
    expect(effective.extensions).toEqual(['gcode']);
    expect(effective.source).toBe('personal');
  });

  // A connection whose DEK is not armed cannot run a turn, so its owner is not
  // paying for anything and their limits must not govern — the instance row
  // does. Reading the owner off the raw config instead of the resolved runtime
  // is exactly how that goes wrong.
  it('ignores the owner of a locked connection', async () => {
    const service = makeService(
      [
        row('instance', { extensions: 'log' }),
        row('user-1', { extensions: 'gcode' }),
      ],
      { status: 'locked', ownerUserId: 'user-1' },
    );
    const effective = await service.resolveEffective();
    expect(effective.extensions).toEqual(['log']);
    expect(effective.source).toBe('instance');
  });

  // An instance connection has no owner — the instance ruleset governs, which
  // is also the single-user path.
  it('falls back to the instance ruleset when the connection is the instance one', async () => {
    const service = makeService(
      [row('instance', { extensions: 'log' }), row('user-1')],
      { status: 'ready', ownerUserId: null },
    );
    const effective = await service.resolveEffective();
    expect(effective.extensions).toEqual(['log']);
    expect(effective.source).toBe('instance');
  });

  it('falls back to the instance ruleset when the owner stored none', async () => {
    const service = makeService([row('instance', { extensions: 'log' })], {
      status: 'ready',
      ownerUserId: 'user-1',
    });
    const effective = await service.resolveEffective();
    expect(effective.source).toBe('instance');
  });

  // No provider configured at all (a fresh install): the gate still needs an
  // answer, and it is the shipped default.
  it('falls back to the code defaults when nothing is stored', async () => {
    const service = makeService([], { status: 'none' });
    const effective = await service.resolveEffective();
    expect(effective.source).toBe('default');
    expect(effective.extensions).toEqual(DEFAULT_ATTACHMENT_RULES.extensions);
  });

  it('reads a stored list back normalised', async () => {
    const service = makeService(
      [row('instance', { extensions: '.GCODE\nstl\nstl\n' })],
      { status: 'ready', ownerUserId: null },
    );
    const rules = await service.read(null);
    expect(rules?.extensions).toEqual(['gcode', 'stl']);
  });
});

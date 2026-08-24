import { ExternalController } from './external.controller';

// The push half of live enable/disable (#150).
//
// Mounting a plugin in the SPA is driven by a `data:changed` nudge naming this
// plugin; without it only the tab that clicked would update, and only because
// it also refreshes locally. So the nudge is asserted here at the one place it
// is emitted — an admin action that changes the installed set.

const emit = jest.fn();
const noop = jest.fn().mockResolvedValue(undefined);

const controller = (): ExternalController =>
  new ExternalController(
    {
      approve: noop,
      setEnabled: noop,
      uninstall: jest.fn().mockResolvedValue({ purgeFailed: false }),
    } as never,
    {} as never,
    { publish: noop, forgetPlugin: noop } as never,
    { syncPlugin: noop } as never,
    { applyDeferred: noop } as never,
    { syncPlugin: noop } as never,
    { provision: noop } as never,
    {} as never,
    {} as never,
    { t: (key: string) => key } as never,
    { emitDataChangedForScope: emit } as never,
    { get: () => undefined } as never,
    { resolveUri: noop } as never,
  );

describe('external lifecycle notifications', () => {
  beforeEach(() => emit.mockClear());

  it('broadcasts on approve', async () => {
    await controller().approve('demo');
    // Instance-wide (scope null): the installed set is not per-scope, and every
    // signed-in client renders a sidebar built from it.
    expect(emit).toHaveBeenCalledWith(['external'], null);
  });

  it('broadcasts on enable and on disable', async () => {
    await controller().setEnabled('demo', { enabled: true } as never);
    await controller().setEnabled('demo', { enabled: false } as never);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('broadcasts on uninstall', async () => {
    await controller().uninstall('demo', {} as never);
    expect(emit).toHaveBeenCalledWith(['external'], null);
  });
});

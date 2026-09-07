import { TelemetryService } from './telemetry.service';

// What these tests are really guarding: an instance that has not said yes must
// be indistinguishable, from the outside, from an instance with the feature
// compiled out. Everything else here is detail.

type Row = {
  consent: string;
  instanceId: string | null;
  locale: string | null;
  promptedAt: Date | null;
  lastSentAt: Date | null;
  // Optional in the fixture: most cases do not care when the last attempt was,
  // and only the pacing tests set it.
  lastAttemptAt?: Date | null;
  lastStatus: string;
};

const makeService = (
  row: Row | null,
  endpoint: string | null = 'https://ping.example.invalid/v1/ping',
) => {
  let current: Row | null = row;
  const prisma = {
    telemetrySettings: {
      findUnique: jest.fn(async () => current),
      upsert: jest.fn(async ({ create, update }: never) => {
        const patch = (current ? update : create) as Partial<Row>;
        current = {
          consent: 'unasked',
          instanceId: null,
          locale: null,
          promptedAt: null,
          lastSentAt: null,
          lastAttemptAt: null,
          lastStatus: 'never',
          ...(current ?? {}),
          ...patch,
        } as Row;
        return current;
      }),
      update: jest.fn(async ({ data }: never) => {
        current = { ...(current as Row), ...(data as Partial<Row>) };
        return current;
      }),
    },
  };
  const service = new TelemetryService(
    prisma as never,
    {
      getTelemetryEndpoint: () => endpoint,
      getAppVersion: () => '0.17.0',
    } as never,
    { getInstallInfo: () => ({ method: 'compose' }) } as never,
    {
      getStates: () => [
        { pluginId: 'projects', isEnabled: true },
        { pluginId: 'chat', isEnabled: false },
        { pluginId: 'inventory', isEnabled: true },
      ],
    } as never,
  );
  return { service, prisma, read: () => current };
};

const okFetch = () =>
  jest.fn(async () => ({ ok: true, status: 204 })) as unknown as typeof fetch;

describe('TelemetryService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports an untouched instance as unasked, with no id', async () => {
    const { service } = makeService(null);
    const state = await service.getState();

    expect(state.consent).toBe('unasked');
    expect(state.instanceId).toBeNull();
    expect(state.prompted).toBe(false);
  });

  // The rule the whole feature stands on.
  it('sends nothing while consent is anything but granted', async () => {
    const fetchMock = okFetch();
    global.fetch = fetchMock;

    for (const consent of ['unasked', 'denied']) {
      const { service } = makeService({
        consent,
        instanceId: 'i-1',
        locale: 'en',
        promptedAt: new Date(0),
        lastSentAt: null,
        lastStatus: 'never',
      });
      await service.scheduledPing();
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mints an id and pings at once when a human agrees', async () => {
    const fetchMock = okFetch();
    global.fetch = fetchMock;
    const { service, read } = makeService(null);

    const state = await service.setConsent(true, 'ru');

    expect(state.consent).toBe('granted');
    expect(state.instanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(read()?.locale).toBe('ru');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mints no id for a refusal — a declining instance carries no identity', async () => {
    const fetchMock = okFetch();
    global.fetch = fetchMock;
    const { service } = makeService(null);

    const state = await service.setConsent(false);

    expect(state.consent).toBe('denied');
    expect(state.instanceId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Off and on again is one install. A fresh id would inflate the very number
  // this feature exists to measure.
  it('keeps the id across a refusal, so re-enabling is the same instance', async () => {
    global.fetch = okFetch();
    const { service } = makeService(null);

    const first = await service.setConsent(true);
    await service.setConsent(false);
    const again = await service.setConsent(true);

    expect(again.instanceId).toBe(first.instanceId);
  });

  it('records being asked without recording an answer', async () => {
    const { service } = makeService(null);

    const state = await service.markPrompted();

    expect(state.prompted).toBe(true);
    expect(state.consent).toBe('unasked');
  });

  it('waits a day between pings', async () => {
    const fetchMock = okFetch();
    global.fetch = fetchMock;
    const { service } = makeService({
      consent: 'granted',
      instanceId: 'i-1',
      locale: 'en',
      promptedAt: new Date(),
      lastSentAt: new Date(Date.now() - 60 * 60 * 1000),
      lastAttemptAt: new Date(Date.now() - 60 * 60 * 1000),
      lastStatus: 'ok',
    });

    await service.scheduledPing();
    expect(fetchMock).not.toHaveBeenCalled();

    const due = makeService({
      consent: 'granted',
      instanceId: 'i-1',
      locale: 'en',
      promptedAt: new Date(),
      lastSentAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      lastAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      lastStatus: 'ok',
    });
    await due.service.scheduledPing();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The daily promise used to hold only for instances that could reach us: the
  // schedule counted from the last SUCCESS, so an instance with no outbound
  // network had nothing to count from and re-tried on every hourly tick.
  it('waits a day after a failed attempt too', async () => {
    const failing = jest.fn(async () => {
      throw new Error('network down');
    });
    global.fetch = failing as never;

    const { service, prisma } = makeService({
      consent: 'granted',
      instanceId: 'i-1',
      locale: 'en',
      promptedAt: new Date(),
      lastSentAt: null,
      lastAttemptAt: null,
      lastStatus: 'never',
    });

    await service.scheduledPing();
    expect(failing).toHaveBeenCalledTimes(1);
    // The attempt is recorded even though it failed; the success stamp is not.
    const written = prisma.telemetrySettings.update.mock.calls[0][0]['data'];
    expect(written['lastAttemptAt']).toBeInstanceOf(Date);
    expect(written['lastSentAt']).toBeUndefined();
    expect(written['lastStatus']).toBe('unreachable');

    // An hour later, still not due.
    await service.scheduledPing();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('carries the documented fields and nothing else', async () => {
    const { service } = makeService(null);

    const payload = await service.buildPayload('i-1', 'ru');

    expect(payload).toEqual({
      instanceId: 'i-1',
      version: '0.17.0',
      installMethod: 'compose',
      plugins: ['inventory', 'projects'],
      locale: 'ru',
    });
  });

  // A preview that shows the reader's language while the report carries the
  // one captured at consent would be a lie told by the very block that exists
  // to be checkable.
  it('previews the locale that will actually be sent, not the reader own', async () => {
    global.fetch = okFetch();
    const { service } = makeService(null);
    await service.setConsent(true, 'ru');

    const preview = await service.getPreview('en');

    expect(preview.locale).toBe('ru');
  });

  it('falls back to the reader locale while nothing is stored', async () => {
    const { service } = makeService(null);

    const preview = await service.getPreview('en');

    expect(preview.locale).toBe('en');
    expect(preview.instanceId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('stays quiet when the build has nowhere to send', async () => {
    const fetchMock = okFetch();
    global.fetch = fetchMock;
    const { service } = makeService(null, null);

    const state = await service.setConsent(true);

    expect(state.endpointConfigured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The answer is recorded and returned; the report leaves on its own. An
  // instance with no route out sits in the send's ten-second timeout, and
  // awaiting it held the settings switch for all ten seconds — for a request
  // whose real work was already done.
  it('answers without waiting for the report to leave', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    global.fetch = jest.fn(async () => {
      await blocked;
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const { service } = makeService(null);

    const state = await service.setConsent(true);

    // Returned while the send is still hanging.
    expect(state.consent).toBe('granted');
    expect(state.instanceId).not.toBeNull();
    release?.();
  });

  it('survives an unreachable receiver and says so', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const { service } = makeService(null);

    await service.setConsent(true);
    // The detached send settles on the microtask queue behind the response.
    await new Promise((resolve) => setImmediate(resolve));
    const state = await service.getState();

    expect(state.consent).toBe('granted');
    expect(state.lastStatus).toBe('unreachable');
    expect(state.lastSentAt).toBeNull();
  });
});

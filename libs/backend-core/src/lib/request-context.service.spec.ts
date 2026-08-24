import { RequestContextService } from './request-context.service';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('returns undefined outside of a context frame', () => {
    expect(service.get()).toBeUndefined();
  });

  it('propagates the store across await chains', async () => {
    const result = await service.run({ userId: 'u1' }, async () => {
      await Promise.resolve();
      const inner = async (): Promise<string | undefined> => {
        await new Promise((resolve) => setImmediate(resolve));
        return service.get()?.userId;
      };
      return inner();
    });
    expect(result).toBe('u1');
  });

  it('assign mutates the live store visible to later reads', async () => {
    await service.run({}, async () => {
      service.assign({ scopeId: 's1', accessLevel: 'OWNER' });
      await Promise.resolve();
      expect(service.get()).toMatchObject({
        scopeId: 's1',
        accessLevel: 'OWNER',
      });
    });
  });

  it('runWithoutScope records the reason on a copy and restores after', async () => {
    await service.run({ userId: 'u1', scopeId: 's1' }, async () => {
      await service.runWithoutScope('exchange', async () => {
        expect(service.get()?.systemBypassReason).toBe('exchange');
        expect(service.get()?.scopeId).toBe('s1');
      });
      expect(service.get()?.systemBypassReason).toBeUndefined();
    });
  });

  it('runWithoutScope outside a frame just runs the callback', async () => {
    await expect(
      service.runWithoutScope('exchange', async () => 'ok'),
    ).resolves.toBe('ok');
  });

  it('runWithScope retargets scope+user as owner and clears grant constraints', async () => {
    await service.run(
      {
        userId: 'admin',
        scopeId: 'admin',
        accessLevel: 'READ',
        modelConstraints: [{ Project: { id: 'x' } }],
      },
      async () => {
        await service.runWithScope('target-user', async () => {
          expect(service.get()).toMatchObject({
            scopeId: 'target-user',
            userId: 'target-user',
            accessLevel: 'OWNER',
            systemBypassReason: undefined,
          });
          expect(service.get()?.modelConstraints).toBeUndefined();
        });
        // The outer request context is untouched.
        expect(service.get()).toMatchObject({
          userId: 'admin',
          scopeId: 'admin',
        });
        expect(service.get()?.modelConstraints).toHaveLength(1);
      },
    );
  });

  it('runWithScope establishes a frame even with no outer context', async () => {
    const scopeId = await service.runWithScope(
      'u9',
      async () => service.get()?.scopeId,
    );
    expect(scopeId).toBe('u9');
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DbQueryContext,
  PluginI18nService,
  PrismaService,
  RequestContextData,
  RequestContextService,
} from '@makekeeper/backend-core';
import { ScopePolicyService } from './scope-policy.service';

describe('ScopePolicyService', () => {
  let requestContext: RequestContextService;
  let findFirstDynamic: jest.Mock;
  let policy: ScopePolicyService;

  beforeEach(async () => {
    findFirstDynamic = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScopePolicyService,
        RequestContextService,
        PluginI18nService,
        { provide: PrismaService, useValue: { findFirstDynamic } },
      ],
    }).compile();
    policy = moduleRef.get(ScopePolicyService);
    requestContext = moduleRef.get(RequestContextService);
  });

  const ctx = (
    model: string,
    operation: string,
    args: unknown,
  ): DbQueryContext & { query: jest.Mock } => ({
    model,
    operation,
    args,
    query: jest.fn().mockResolvedValue('result'),
  });

  const inScope = (
    data: Partial<RequestContextData>,
    fn: () => Promise<unknown>,
  ): Promise<unknown> =>
    requestContext.run(
      { userId: 'me', scopeId: 'owner1', accessLevel: 'OWNER', ...data },
      fn,
    );

  it('passes through without a request context', async () => {
    const c = ctx('Project', 'findMany', { where: { status: 'IDEA' } });
    await policy.run(c);
    expect(c.query).toHaveBeenCalledWith({ where: { status: 'IDEA' } });
  });

  it('passes through for unscoped models', async () => {
    const c = ctx('PluginConfig', 'findMany', {});
    await inScope({}, () => policy.run(c));
    expect(c.query).toHaveBeenCalledWith({});
  });

  it('passes through under a system-bypass reason', async () => {
    const c = ctx('Project', 'updateMany', { where: { scopeId: null } });
    await inScope({ systemBypassReason: 'exchange' }, () => policy.run(c));
    expect(c.query).toHaveBeenCalledWith({ where: { scopeId: null } });
  });

  it('AND-merges the scope filter into findMany on a direct model', async () => {
    const c = ctx('Project', 'findMany', { where: { status: 'IDEA' } });
    await inScope({}, () => policy.run(c));
    expect(c.query).toHaveBeenCalledWith({
      where: { AND: [{ status: 'IDEA' }, { scopeId: 'owner1' }] },
    });
  });

  it('applies grant constraints on top of the scope filter', async () => {
    const c = ctx('Task', 'findMany', {});
    await inScope(
      { modelConstraints: [{ Task: { projectId: { in: ['p1'] } } }] },
      () => policy.run(c),
    );
    expect(c.query).toHaveBeenCalledWith({
      where: {
        AND: [
          {},
          { project: { scopeId: 'owner1' } },
          { projectId: { in: ['p1'] } },
        ],
      },
    });
  });

  it('rewrites findUnique to a policy-filtered findFirst', async () => {
    findFirstDynamic.mockResolvedValue({ id: 'p1' });
    const c = ctx('Project', 'findUnique', { where: { id: 'p1' } });
    const result = await inScope({}, () => policy.run(c));
    expect(result).toEqual({ id: 'p1' });
    expect(findFirstDynamic).toHaveBeenCalledWith('Project', {
      where: { id: 'p1' },
    });
    expect(c.query).not.toHaveBeenCalled();
  });

  it('stamps scopeId on direct-model creates', async () => {
    const data: Record<string, unknown> = { id: 'p9', title: 't' };
    const c = ctx('Project', 'create', { data });
    await inScope({}, () => policy.run(c));
    expect(data.scopeId).toBe('owner1');
    expect(c.query).toHaveBeenCalled();
  });

  it('verifies parent ownership on child creates and 404s outside the scope', async () => {
    findFirstDynamic.mockResolvedValue(null);
    const c = ctx('Task', 'create', {
      data: { id: 't1', projectId: 'foreign', title: 'x' },
    });
    await expect(inScope({}, () => policy.run(c))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(c.query).not.toHaveBeenCalled();
  });

  // #130: a turn taken with no project in scope writes `projectId: null`, and a
  // parent that was not named has nothing to prove. Refusing it took the whole
  // chat down in multi-user mode — every project-less message failed to save.
  // The row is still confined: its scope comes from the session relation.
  it('accepts a child create whose nullable parent FK is absent', async () => {
    const c = ctx('AIChatMessage', 'create', {
      data: { id: 'm1', sessionId: 's1', projectId: null, role: 'user' },
    });
    findFirstDynamic.mockResolvedValue({ id: 's1' });

    await inScope({}, () => policy.run(c));

    expect(findFirstDynamic).toHaveBeenCalledTimes(1);
    expect(findFirstDynamic).toHaveBeenCalledWith('AIChatSession', {
      where: { id: 's1' },
      select: { id: true },
    });
    expect(c.query).toHaveBeenCalled();
  });

  // A named parent is still proven — the point of the stamp is that a turn
  // cannot claim a project the caller cannot see.
  it('still verifies a nullable parent FK when the create names one', async () => {
    findFirstDynamic.mockImplementation((model: string) =>
      Promise.resolve(model === 'AIChatSession' ? { id: 's1' } : null),
    );
    const c = ctx('AIChatMessage', 'create', {
      data: { id: 'm1', sessionId: 's1', projectId: 'foreign', role: 'user' },
    });

    await expect(inScope({}, () => policy.run(c))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(c.query).not.toHaveBeenCalled();
  });

  it('pre-checks update targets within scope + constraints', async () => {
    findFirstDynamic.mockResolvedValue(null);
    const c = ctx('Project', 'update', {
      where: { id: 'p2' },
      data: { title: 'new' },
    });
    await expect(inScope({}, () => policy.run(c))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects every mutation under a READ grant', async () => {
    const c = ctx('Project', 'create', { data: { id: 'p9' } });
    await expect(
      inScope({ accessLevel: 'READ' }, () => policy.run(c)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('binds chats to the USER, not the active scope', async () => {
    // Reads filter by the caller's id even while browsing a shared scope…
    const list = ctx('AIChatSession', 'findMany', {});
    await inScope(
      { modelConstraints: [{ AIChatSession: { projectId: { in: ['p1'] } } }] },
      () => policy.run(list),
    );
    // …and grant constraints never narrow private rows.
    expect(list.query).toHaveBeenCalledWith({
      where: { AND: [{}, { scopeId: 'me' }] },
    });
    // Creates stamp the user and stay allowed under a READ grant.
    const data: Record<string, unknown> = { id: 's1', projectId: 'p1' };
    const create = ctx('AIChatSession', 'create', { data });
    await inScope({ accessLevel: 'READ' }, () => policy.run(create));
    expect(data.scopeId).toBe('me');
    expect(create.query).toHaveBeenCalled();
  });

  // #125: a file belongs to the thing it was filed under, and only a file with
  // no parent at all belongs to whoever uploaded it. Binding every attachment
  // to its uploader is what made a shared project's Files tab come back empty.
  describe('conditional binding (Attachment)', () => {
    // A parentless row is the caller's; a parented one is the scope's. Note
    // what is NOT in the filter: `sessionId`. A chat is a conversation, not
    // something a file becomes part of, so a picture sent with a project open
    // is that project's file — for everyone the project is shared with.
    // `intakeDraftId` joined the set in #216: a conveyor frame belongs to the
    // draft it was shot for, exactly as a photo belongs to its item.
    const PARENTLESS = {
      AND: [
        { projectId: null },
        { componentId: null },
        { intakeDraftId: null },
      ],
    };
    const PARENTED = {
      OR: [
        { projectId: { not: null } },
        { componentId: { not: null } },
        { intakeDraftId: { not: null } },
      ],
    };

    it("reads parentless rows as the caller's and parented ones as the scope's", async () => {
      const list = ctx('Attachment', 'findMany', {});
      await inScope({}, () => policy.run(list));

      expect(list.query).toHaveBeenCalledWith({
        where: {
          AND: [
            {},
            {
              OR: [
                { AND: [PARENTLESS, { scopeId: 'me' }] },
                { AND: [PARENTED, { scopeId: 'owner1' }] },
              ],
            },
          ],
        },
      });
    });

    // The split is owned by the policy, not by each plugin's descriptor: a
    // grant narrows the shared half only, so a failed or narrow restriction can
    // never reach into the caller's own private files.
    it('applies grant restrictions to the shared half only', async () => {
      const list = ctx('Attachment', 'findMany', {});
      await inScope(
        { modelConstraints: [{ Attachment: { projectId: { in: ['p1'] } } }] },
        () => policy.run(list),
      );

      expect(list.query).toHaveBeenCalledWith({
        where: {
          AND: [
            {},
            {
              OR: [
                { AND: [PARENTLESS, { scopeId: 'me' }] },
                {
                  AND: [
                    PARENTED,
                    { scopeId: 'owner1' },
                    { projectId: { in: ['p1'] } },
                  ],
                },
              ],
            },
          ],
        },
      });
    });

    it('stamps a parentless file with its uploader and a parented one with the scope', async () => {
      const chatPicture: Record<string, unknown> = {
        id: 'a1',
        sessionId: 's1',
      };
      await inScope({}, () =>
        policy.run(ctx('Attachment', 'create', { data: chatPicture })),
      );
      expect(chatPicture.scopeId).toBe('me');

      // The same picture sent while a project is open is the project's file.
      findFirstDynamic.mockResolvedValue({ id: 'p1' });
      const inProject: Record<string, unknown> = {
        id: 'a2',
        sessionId: 's1',
        projectId: 'p1',
      };
      await inScope({}, () =>
        policy.run(ctx('Attachment', 'create', { data: inProject })),
      );
      expect(inProject.scopeId).toBe('owner1');
    });

    // Chatting in a read-only scope stays possible; adding to its files does not.
    it('confines a READ grant to the private half instead of refusing outright', async () => {
      const chatPicture = ctx('Attachment', 'create', {
        data: { id: 'a1', sessionId: 's1' },
      });
      await inScope({ accessLevel: 'READ' }, () => policy.run(chatPicture));
      expect(chatPicture.query).toHaveBeenCalled();

      const projectFile = ctx('Attachment', 'create', {
        data: { id: 'a2', projectId: 'p1' },
      });
      await expect(
        inScope({ accessLevel: 'READ' }, () => policy.run(projectFile)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(projectFile.query).not.toHaveBeenCalled();
    });

    // The regression this replaced: deleting one's OWN chat picture inside a
    // read-only scope used to 403, because the model as a whole stopped being
    // user-bound.
    it('still lets the caller delete their own parentless file under READ', async () => {
      const remove = ctx('Attachment', 'deleteMany', { where: { id: 'a1' } });
      await inScope({ accessLevel: 'READ' }, () => policy.run(remove));

      expect(remove.query).toHaveBeenCalledWith({
        where: {
          AND: [{ id: 'a1' }, { AND: [PARENTLESS, { scopeId: 'me' }] }],
        },
      });
    });

    it('refuses to give a file a parent under a READ grant', async () => {
      const adopt = ctx('Attachment', 'updateMany', {
        where: { id: 'a1' },
        data: { projectId: 'p1', componentId: null },
      });
      await expect(
        inScope({ accessLevel: 'READ' }, () => policy.run(adopt)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // A component photo has a parent to prove, exactly like a project file.
    it('verifies the component parent on create', async () => {
      findFirstDynamic.mockResolvedValue(null);
      const orphan = ctx('Attachment', 'create', {
        data: { id: 'a3', componentId: 'c-elsewhere' },
      });
      await expect(
        inScope({}, () => policy.run(orphan)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Re-homing is the policy's job, not the caller's: a file moved into a
    // project becomes the project's, and a caller that had to remember to
    // restamp `scopeId` itself would leave the row invisible to its new owner.
    it('restamps the owner when a file is re-parented', async () => {
      findFirstDynamic.mockResolvedValue({ id: 'p1' });
      const data: Record<string, unknown> = {
        projectId: 'p1',
        componentId: null,
        intakeDraftId: null,
      };
      await inScope({}, () =>
        policy.run(
          ctx('Attachment', 'updateMany', { where: { id: 'a1' }, data }),
        ),
      );
      expect(data.scopeId).toBe('owner1');

      const orphaning: Record<string, unknown> = {
        projectId: null,
        componentId: null,
        intakeDraftId: null,
      };
      await inScope({}, () =>
        policy.run(
          ctx('Attachment', 'updateMany', {
            where: { id: 'a1' },
            data: orphaning,
          }),
        ),
      );
      expect(orphaning.scopeId).toBe('me');
    });

    // The new owner is a property of the whole row, and an updateMany has no
    // single row to read the unstated half from. Guessing would silently file
    // the result under the wrong owner.
    it('fails loud on a partial re-parenting', async () => {
      const partial = ctx('Attachment', 'updateMany', {
        where: { id: 'a1' },
        data: { projectId: 'p1' },
      });
      findFirstDynamic.mockResolvedValue({ id: 'p1' });
      await expect(inScope({}, () => policy.run(partial))).rejects.toThrow();
    });

    // Nothing above may change what a single-user install does: with no sharing
    // the two owners are the same id, so both halves collapse to one filter.
    it('collapses to the old behaviour when the caller owns the scope', async () => {
      const list = ctx('Attachment', 'findMany', {});
      await requestContext.run(
        { userId: 'solo', scopeId: 'solo', accessLevel: 'OWNER' },
        () => policy.run(list),
      );

      expect(list.query).toHaveBeenCalledWith({
        where: {
          AND: [
            {},
            {
              OR: [
                { AND: [PARENTLESS, { scopeId: 'solo' }] },
                { AND: [PARENTED, { scopeId: 'solo' }] },
              ],
            },
          ],
        },
      });
    });
  });

  it('fails loud on scoped-model upserts', async () => {
    const c = ctx('Project', 'upsert', { where: { id: 'p1' } });
    await expect(inScope({}, () => policy.run(c))).rejects.toThrow();
    expect(c.query).not.toHaveBeenCalled();
  });

  it('rejects an explicit foreign scopeId in update data', async () => {
    findFirstDynamic.mockResolvedValue({ id: 'p1' });
    const c = ctx('Project', 'update', {
      where: { id: 'p1' },
      data: { scopeId: 'someone-else' },
    });
    await expect(inScope({}, () => policy.run(c))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a foreign scopeId in updateMany data (bulk re-homing)', async () => {
    const c = ctx('Project', 'updateMany', {
      where: { status: 'IDEA' },
      data: { scopeId: 'someone-else' },
    });
    await expect(inScope({}, () => policy.run(c))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(c.query).not.toHaveBeenCalled();
  });

  it('allows updateMany when data does not touch scopeId', async () => {
    const c = ctx('Project', 'updateMany', {
      where: { status: 'IDEA' },
      data: { title: 'renamed' },
    });
    await inScope({}, () => policy.run(c));
    expect(c.query).toHaveBeenCalledWith({
      where: { AND: [{ status: 'IDEA' }, { scopeId: 'owner1' }] },
      data: { title: 'renamed' },
    });
  });

  it('verifies a direct-model FK on create and 404s a cross-scope parent', async () => {
    findFirstDynamic.mockResolvedValue(null);
    const c = ctx('Component', 'create', {
      data: { id: 'c1', name: 'x', storageId: 'foreign-storage' },
    });
    await expect(inScope({}, () => policy.run(c))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirstDynamic).toHaveBeenCalledWith('Storage', {
      where: { id: 'foreign-storage' },
      select: { id: true },
    });
    expect(c.query).not.toHaveBeenCalled();
  });

  it('skips the FK check when a nullable direct-model FK is unset', async () => {
    const data: Record<string, unknown> = { id: 'c2', name: 'x' };
    const c = ctx('Component', 'create', { data });
    await inScope({}, () => policy.run(c));
    expect(findFirstDynamic).not.toHaveBeenCalled();
    expect(data.scopeId).toBe('owner1');
    expect(c.query).toHaveBeenCalled();
  });
});

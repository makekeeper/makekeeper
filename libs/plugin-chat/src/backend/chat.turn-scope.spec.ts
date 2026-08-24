import { ChatService } from './chat.service';

// The scope a CONTINUATION runs in (#130). Confirming a tool call, cancelling it
// or retrying after a failure carries on a turn that already happened, so it
// must keep that turn's project rather than read whatever scope the client
// carries now — the user may have navigated between seeing the card and
// clicking it. The scope is read back off the messages the turn wrote.

type MessageRow = { createdAt: Date; projectId: string | null };

// Only the one query this path makes is stood up, and it HONOURS the filter it
// is given: a fake that ignored `where` would pass either way, which is exactly
// the bug this spec is here for.
const makeService = (messages: MessageRow[]): ChatService => {
  const prisma = {
    aIChatMessage: {
      findFirst: ({
        where,
      }: {
        where: { sessionId: string; projectId?: { not: null } };
      }): Promise<MessageRow | null> => {
        const matching = messages.filter(
          (message) => !where.projectId || message.projectId !== null,
        );
        const newest = [...matching].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return Promise.resolve(newest[0] ?? null);
      },
    },
  };
  return new ChatService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
};

// Private on purpose — every caller of it is a whole agent turn, and this is the
// one decision in them worth pinning down on its own.
const scopeOf = (
  service: ChatService,
  sessionId: string,
): Promise<string | null> => service['lastTurnProjectId'](sessionId);

describe('the scope a continued turn keeps', () => {
  it('is the project the turn it continues was stamped with', async () => {
    const service = makeService([
      { createdAt: new Date('2026-08-01T10:00:00Z'), projectId: 'p1' },
      { createdAt: new Date('2026-08-01T11:00:00Z'), projectId: 'p2' },
    ]);

    expect(await scopeOf(service, 's1')).toBe('p2');
  });

  // The reason the query may not skip unstamped messages. "No project" is a
  // scope the user can choose, and it has to survive a tool confirmation:
  // reviving an older turn's project here would put it into the prompt and
  // stamp it onto the continuation's messages and its usage rows — a project's
  // turn list and its token spend would then report work it never scoped.
  it('is nothing when the turn it continues carried no project', async () => {
    const service = makeService([
      { createdAt: new Date('2026-08-01T10:00:00Z'), projectId: 'p1' },
      { createdAt: new Date('2026-08-01T11:00:00Z'), projectId: null },
    ]);

    expect(await scopeOf(service, 's1')).toBeNull();
  });

  it('is nothing in a conversation with no messages yet', async () => {
    const service = makeService([]);

    expect(await scopeOf(service, 's1')).toBeNull();
  });
});

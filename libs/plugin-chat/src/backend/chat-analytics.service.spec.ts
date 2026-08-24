import { ChatAnalyticsService } from './chat-analytics.service';

// ChatAnalyticsService only reads Prisma and resolves object refs — extracting
// it from ChatService made it reachable with a plain Prisma stub, no agent
// loop / LLM / realtime stack required.

interface FindManyMock {
  findMany: jest.Mock;
  count: jest.Mock;
}

const makeService = (): {
  service: ChatAnalyticsService;
  message: FindManyMock;
} => {
  const message: FindManyMock = { findMany: jest.fn(), count: jest.fn() };
  const prisma = { aIChatMessage: message };
  const agentRegistry = { resolveObjectRef: jest.fn() };
  const service = new ChatAnalyticsService(
    prisma as never,
    agentRegistry as never,
  );
  return { service, message };
};

describe('ChatAnalyticsService', () => {
  it('buckets a day of activity into messages vs tool actions', async () => {
    const { service, message } = makeService();
    const today = new Date();
    // getActivity queries human rows first, then tool-response rows.
    message.findMany
      .mockResolvedValueOnce([{ createdAt: today }, { createdAt: today }])
      .mockResolvedValueOnce([{ createdAt: today }]);

    const result = await service.getActivity(1);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ messages: 2, toolActions: 1 });
  });

  it('clamps the day span to at most 90 days', async () => {
    const { service, message } = makeService();
    message.findMany.mockResolvedValue([]);
    const result = await service.getActivity(1000);
    expect(result).toHaveLength(90);
  });

  it('returns an empty result for a blank search query without hitting the db', async () => {
    const { service, message } = makeService();
    const result = await service.searchProjectMessages('p1', '   ', 10, 0);
    expect(result).toEqual({ hits: [], total: 0 });
    expect(message.findMany).not.toHaveBeenCalled();
  });

  it('maps search rows to hits with a match-centered snippet', async () => {
    const { service, message } = makeService();
    message.findMany.mockResolvedValueOnce([
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: 'the answer mentions foo somewhere in the text',
        createdAt: new Date(),
        session: { title: 'Session One', messages: [] },
      },
    ]);
    message.count.mockResolvedValueOnce(1);

    const result = await service.searchProjectMessages('p1', 'foo', 10, 0);

    expect(result.total).toBe(1);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      sessionId: 's1',
      messageId: 'm1',
      sessionTitle: 'Session One',
    });
    expect(result.hits[0].snippet.toLowerCase()).toContain('foo');
  });
});

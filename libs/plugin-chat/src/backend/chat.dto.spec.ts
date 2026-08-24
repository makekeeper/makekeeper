import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatSendCommandDto } from './chat.dto';

// Exercises the per-message page-context validation added for issue #3: the nested
// PageContextDto and the custom short-string-record constraint on params/query.
// The send action is a socket command (#61), so a valid payload carries sessionId.
describe('ChatSendCommandDto page context', () => {
  const validatePlain = (plain: unknown) =>
    validate(plainToInstance(ChatSendCommandDto, plain));

  it('accepts a message with no page context (optional)', async () => {
    const errors = await validatePlain({ sessionId: 's1', message: 'hi' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a well-formed page context', async () => {
    const errors = await validatePlain({
      sessionId: 's1',
      message: 'delete this item',
      pageContext: {
        routeName: 'project-detail',
        path: '/projects/abc123',
        pluginId: 'projects',
        params: { id: 'abc123' },
        query: { tab: 'components' },
      },
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a params value that exceeds the length bound', async () => {
    const errors = await validatePlain({
      sessionId: 's1',
      message: 'hi',
      pageContext: { params: { id: 'x'.repeat(501) } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string params value', async () => {
    const errors = await validatePlain({
      sessionId: 's1',
      message: 'hi',
      pageContext: { params: { id: 42 } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a params map with too many entries', async () => {
    const params: Record<string, string> = {};
    for (let i = 0; i < 31; i++) params[`k${i}`] = 'v';
    const errors = await validatePlain({
      sessionId: 's1',
      message: 'hi',
      pageContext: { params },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string routeName', async () => {
    const errors = await validatePlain({
      sessionId: 's1',
      message: 'hi',
      pageContext: { routeName: 123 },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a missing sessionId', async () => {
    const errors = await validatePlain({ message: 'hi' });
    expect(errors.length).toBeGreaterThan(0);
  });
});

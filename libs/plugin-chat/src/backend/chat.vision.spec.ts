import { ChatService } from './chat.service';
import type { HistoryMessage } from './chat.types';

// Several frames, one vision call (#215).
//
// The implementation is deliberately shallow: one history user message per
// image, which the LLM layer already knows how to resolve (#113). These tests
// pin THAT — that the frames arrive as separate captioned messages with the
// caller's question on the last one — because the alternative (an array on
// `HistoryMessage.imageData`, and four rewritten provider builders) was
// explicitly rejected, and a silent drift back toward it would go unnoticed.

const build = (): { service: ChatService; sent: HistoryMessage[][] } => {
  const sent: HistoryMessage[][] = [];
  const providerService = {
    resolveActiveRuntime: () =>
      Promise.resolve({
        status: 'ready',
        config: { provider: 'openai', modelName: 'gpt', name: null },
        ownerUserId: null,
      }),
    recordRuntimeUse: () => Promise.resolve(),
  };
  const llm = {
    complete: (
      _provider: unknown,
      _system: string,
      history: HistoryMessage[],
    ) => {
      sent.push(history);
      return Promise.resolve('ok');
    },
  };
  const i18n = {
    // Echo the key with its params, so the assertions are about which caption
    // went where rather than about wording.
    t: (key: string, params?: Record<string, unknown>) =>
      `${key}|${JSON.stringify(params ?? {})}`,
  };
  const prisma = { aIUsageEvent: { create: () => Promise.resolve({}) } };

  const service = new ChatService(
    prisma as never,
    {} as never,
    {} as never,
    providerService as never,
    i18n as never,
    {} as never,
    llm as never,
    {} as never,
    // Request context: a vision one-shot has no caller to name in a proxy label.
    { get: () => null } as never,
    // Capabilities: a one-shot files nothing, so no owner is ever asked.
    {} as never,
  );
  return { service, sent };
};

describe('ChatService.runVisionCompletion with several frames', () => {
  it('sends one user message per image', async () => {
    const { service, sent } = build();

    await service.runVisionCompletion('system', 'Identify this part.', [
      '/api/uploads/att_a',
      '/api/uploads/att_b',
      '/api/uploads/att_c',
    ]);

    expect(sent[0]).toHaveLength(3);
    expect(sent[0].map((m) => m.imageData)).toEqual([
      '/api/uploads/att_a',
      '/api/uploads/att_b',
      '/api/uploads/att_c',
    ]);
  });

  // The question follows the evidence: it rides on the last frame, so the model
  // has seen every angle before it is asked anything.
  it('puts the caller question on the last frame only', async () => {
    const { service, sent } = build();

    await service.runVisionCompletion('system', 'Identify this part.', [
      '/api/uploads/att_a',
      '/api/uploads/att_b',
    ]);

    // Which KEY each frame got is the behaviour: only the last one is the
    // variant whose locale value carries the question. (The double echoes every
    // param, so the question string itself is present in both — that is the
    // stub talking, not the service.)
    expect(sent[0][0].content.startsWith('chat.vision.frameCaption|')).toBe(
      true,
    );
    expect(sent[0][1].content.startsWith('chat.vision.frameCaptionLast|')).toBe(
      true,
    );
    expect(sent[0][0].content).toContain('"index":1,"total":2');
    expect(sent[0][1].content).toContain('"index":2,"total":2');
  });

  // Regression: one frame must behave exactly as it did before the change.
  it('sends a single frame as one message', async () => {
    const { service, sent } = build();

    await service.runVisionCompletion('system', 'Read this order.', [
      '/api/uploads/att_only',
    ]);

    expect(sent[0]).toHaveLength(1);
    expect(sent[0][0].imageData).toBe('/api/uploads/att_only');
    expect(sent[0][0].content).toContain('Read this order.');
  });

  // Not a real call path, but a capability handed an empty list must ask the
  // question rather than send nothing at all.
  it('still asks when there are no frames', async () => {
    const { service, sent } = build();

    await service.runVisionCompletion('system', 'Anything?', []);

    expect(sent[0]).toEqual([{ role: 'user', content: 'Anything?' }]);
  });
});

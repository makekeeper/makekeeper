import { ScanRelayService } from './codes.scan';
import type { PhoneBridgeKindContext } from '@makekeeper/plugin-contract';

const ctx = (token: string): PhoneBridgeKindContext => ({
  token,
  scopeOwnerId: null,
});

describe('ScanRelayService', () => {
  let service: ScanRelayService;
  beforeEach(() => {
    service = new ScanRelayService();
  });

  it('relays a decoded value and echoes it back', async () => {
    const message = await service.onMessage(ctx('t1'), { value: 'CMP-4Z9QX' });
    expect(message).not.toBeNull();
    expect(message?.data).toEqual({ value: 'CMP-4Z9QX' });
  });

  // #79: a contextual session relays which host action the user confirmed on
  // the phone, so the desktop knows what to do with the code.
  it('relays the confirmed action key alongside the value', async () => {
    const message = await service.onMessage(ctx('t1'), {
      value: 'CMP-4Z9QX',
      action: 'place',
    });
    expect(message?.data).toEqual({ value: 'CMP-4Z9QX', action: 'place' });
  });

  it('ignores a payload whose action is not a string', async () => {
    expect(
      await service.onMessage(ctx('t1'), { value: 'A', action: 7 }),
    ).toBeNull();
  });

  it('ignores a payload without a non-empty string value', async () => {
    expect(await service.onMessage(ctx('t1'), { value: '' })).toBeNull();
    expect(await service.onMessage(ctx('t1'), { nope: 1 })).toBeNull();
    expect(await service.onMessage(ctx('t1'), null)).toBeNull();
  });

  it('pages results by a monotonic cursor', async () => {
    await service.onMessage(ctx('t1'), { value: 'A' });
    await service.onMessage(ctx('t1'), { value: 'B' });

    const first = await service.readResults('t1', undefined);
    expect(first.messages.map((m) => m.data)).toEqual([
      { value: 'A' },
      { value: 'B' },
    ]);

    // Nothing new past the last cursor.
    const second = await service.readResults('t1', first.cursor);
    expect(second.messages).toHaveLength(0);

    // A new scan shows up past the cursor.
    await service.onMessage(ctx('t1'), { value: 'C' });
    const third = await service.readResults('t1', first.cursor);
    expect(third.messages.map((m) => m.data)).toEqual([{ value: 'C' }]);
  });

  it('scopes buffers per token', async () => {
    await service.onMessage(ctx('t1'), { value: 'A' });
    const other = await service.readResults('t2', undefined);
    expect(other.messages).toHaveLength(0);
  });

  it('drops a session buffer on garbage collect', async () => {
    await service.onMessage(ctx('t1'), { value: 'A' });
    await service.onGarbageCollect('t1');
    const after = await service.readResults('t1', undefined);
    expect(after.messages).toHaveLength(0);
  });
});

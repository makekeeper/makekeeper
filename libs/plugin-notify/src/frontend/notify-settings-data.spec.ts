const calls: { path: string; options: Record<string, unknown> }[] = [];

jest.mock('@makekeeper/frontend-core', () => ({
  apiFetch: jest.fn(),
  apiJson: jest.fn(
    async (path: string, options: Record<string, unknown> = {}) => {
      calls.push({ path, options });
      return {};
    },
  ),
}));

import {
  saveChannelEnabled,
  savePreferences,
  saveRoutes,
} from './notify-settings-data';

// The bug this file exists to stop coming back: `apiFetch` adds the JSON
// content type only for an OBJECT body — a hand-stringified one is sent with no
// content type, the server reads an empty body, validation fails, and every
// save on the settings screen errors. It looks like a formatting preference and
// is not.
describe('what the settings screen sends', () => {
  beforeEach(() => (calls.length = 0));

  it('passes an object body, never a JSON string', async () => {
    await saveRoutes(['settings.update-available'], ['web-push'], false);
    await saveChannelEnabled('web-push', false);
    await savePreferences({
      quietFromMinutes: 0,
      quietToMinutes: 420,
      timezone: 'Europe/Moscow',
      locale: 'ru',
    });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(typeof call.options['body']).toBe('object');
    }
  });

  it('writes a whole decision in one request', async () => {
    // "None for this plugin" is one thing a person did; a request per cell
    // could land half applied and leave the screen disagreeing with the server.
    await saveRoutes(['a', 'b', 'c'], ['web-push', 'telegram'], true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options['body']).toEqual({
      types: ['a', 'b', 'c'],
      channelIds: ['web-push', 'telegram'],
      enabled: true,
    });
  });
});

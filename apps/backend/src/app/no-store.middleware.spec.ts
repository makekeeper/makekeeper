import type { IncomingMessage, ServerResponse } from 'node:http';
import { createNoStoreMiddleware, NO_STORE } from './no-store.middleware';

// Minimal doubles: the middleware only reads `url` and sets a header.
const makeReq = (url: string): IncomingMessage => ({ url }) as IncomingMessage;

const makeRes = (headers: Record<string, string>): ServerResponse =>
  ({
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  }) as unknown as ServerResponse;

describe('createNoStoreMiddleware', () => {
  const run = (url: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    const next = jest.fn();
    createNoStoreMiddleware()(makeReq(url), makeRes(headers), next);
    expect(next).toHaveBeenCalled();
    return headers;
  };

  it('marks API responses as never-cached', () => {
    expect(run('/api/telemetry')['Cache-Control']).toBe(NO_STORE);
  });

  it('leaves the API docs surface alone', () => {
    expect(run('/api/docs')['Cache-Control']).toBeUndefined();
    expect(run('/api/docs/swagger-ui.css')['Cache-Control']).toBeUndefined();
    // A request URI carries its query string; that is still the docs surface.
    expect(run('/api/docs?tag=items')['Cache-Control']).toBeUndefined();
  });

  it('writes the default before the handler runs, so a handler can overwrite it', () => {
    // This ordering is the whole contract with uploads.controller.ts, which
    // sets its own year-long immutable Cache-Control from inside the handler
    // (#113). That header only wins because ours is already written by the
    // time control is handed on — assert both halves.
    const headers: Record<string, string> = {};
    const res = makeRes(headers);
    const immutableCache = 'private, max-age=31536000, immutable';
    const handler = jest.fn(() => {
      expect(headers['Cache-Control']).toBe(NO_STORE);
      res.setHeader('Cache-Control', immutableCache);
    });

    createNoStoreMiddleware()(makeReq('/api/uploads/abc'), res, handler);

    expect(handler).toHaveBeenCalled();
    expect(headers['Cache-Control']).toBe(immutableCache);
  });
});

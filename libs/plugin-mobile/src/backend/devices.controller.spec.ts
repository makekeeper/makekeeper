import { DevicesController } from './devices.controller';
import type {
  DeviceAuthService,
  PluginI18nService,
  RequestContextService,
} from '@makekeeper/backend-core';
import type { Request } from 'express';
import type { MobileOriginService } from './mobile-origin.service';

// The pairing QR is the ONLY thing that crosses from the desktop to a phone
// before the phone knows anything (#211), so what the desktop is reading in has
// to survive into that URL — the phone is a different browser and has no other
// way of learning it.

function harness(options: { base?: string | null } = {}) {
  const devices = {
    issuePairingCode: () =>
      Promise.resolve({
        id: 'offer-1',
        code: 'code-1',
        expiresAt: new Date('2026-08-03T12:00:00.000Z'),
      }),
  } as unknown as DeviceAuthService;

  const origins = {
    resolveForPhone: () =>
      Promise.resolve({
        url:
          options.base === undefined ? 'https://mk.example.com' : options.base,
        freshlyStarted: false,
      }),
  } as unknown as MobileOriginService;

  const requestContext = {
    get: () => null,
  } as unknown as RequestContextService;
  const i18n = { t: (key: string) => key } as unknown as PluginI18nService;

  return new DevicesController(devices, origins, requestContext, i18n);
}

const request = { headers: {} } as unknown as Request;

describe('DevicesController.createPairingCode', () => {
  it('carries the caller locale into the QR URL', async () => {
    const offer = await harness().createPairingCode(request, 'ru');
    expect(offer.url).toBe('https://mk.example.com/m/pair?code=code-1&lang=ru');
  });

  it('normalizes what the browser reported', async () => {
    const offer = await harness().createPairingCode(request, 'ru-RU');
    expect(offer.url).toContain('lang=ru');
  });

  it('leaves the URL alone when there is no usable locale', async () => {
    // A QR is scanned exactly as painted, so an unusable value must not reach
    // it — the phone then resolves the language on its own.
    const offer = await harness().createPairingCode(request, 'klingon');
    expect(offer.url).toBe('https://mk.example.com/m/pair?code=code-1');
    const none = await harness().createPairingCode(request);
    expect(none.url).toBe('https://mk.example.com/m/pair?code=code-1');
  });

  it('refuses when there is no address a phone could reach', async () => {
    await expect(
      harness({ base: null }).createPairingCode(request, 'ru'),
    ).rejects.toThrow('mobile.errors.noPhoneAddress');
  });
});

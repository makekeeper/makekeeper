import { Test } from '@nestjs/testing';
import {
  PrismaService,
  AttachmentStorageService,
} from '@makekeeper/backend-core';
import { CaptureService } from './capture.service';

// Capture as a phone-bridge kind handler (#77): the phone relays a photo data
// URL, the handler stores it (stamped for the session's scope owner) and the
// desktop poll reads the saved photos back as bridge messages.
describe('CaptureService — phone-bridge kind handler', () => {
  let service: CaptureService;
  let findMany: jest.Mock;
  let saveDataUrl: jest.Mock;
  let deleteByBridgeSession: jest.Mock;

  const photoRow = {
    id: 'att-1',
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
  };

  beforeEach(async () => {
    findMany = jest.fn(() => Promise.resolve([photoRow]));
    saveDataUrl = jest.fn(() => Promise.resolve('/api/uploads/att-1'));
    deleteByBridgeSession = jest.fn(() => Promise.resolve(undefined));
    const moduleRef = await Test.createTestingModule({
      providers: [
        CaptureService,
        {
          provide: PrismaService,
          useValue: { attachment: { findMany } },
        },
        {
          provide: AttachmentStorageService,
          useValue: {
            saveDataUrl,
            deleteByBridgeSession,
            findByUrl: jest.fn(() =>
              Promise.resolve({ id: 'att-1', createdAt: photoRow.createdAt }),
            ),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(CaptureService);
  });

  // Regression for #25: a phone relays on an anonymous public route (no request
  // scope), so the photo must be stamped with the session's stored scope owner —
  // otherwise the desktop's user-bound scoped read never sees it.
  it('stamps a relayed photo with the session scope owner', async () => {
    await service.onMessage(
      { token: 'br_1', scopeOwnerId: 'user-42' },
      { image: 'data:image/jpeg;base64,AAAA' },
    );
    expect(saveDataUrl).toHaveBeenCalledWith(
      { pluginId: 'capture', bridgeSessionId: 'br_1' },
      'data:image/jpeg;base64,AAAA',
      'user-42',
    );
  });

  it('ignores a payload that is not an image relay', async () => {
    const res = await service.onMessage(
      { token: 'br_1', scopeOwnerId: null },
      { value: 'not-an-image' },
    );
    expect(res).toBeNull();
    expect(saveDataUrl).not.toHaveBeenCalled();
  });

  it('maps stored photos to bridge messages carrying the upload URL', async () => {
    const { messages, cursor } = await service.readResults('br_1', undefined);
    expect(messages).toEqual([
      {
        id: 'att-1',
        createdAt: photoRow.createdAt.toISOString(),
        data: { url: '/api/uploads/att-1' },
      },
    ]);
    expect(cursor).toBe(photoRow.createdAt.toISOString());
  });

  it('drops unclaimed photos when the bridge GCs the session', async () => {
    await service.onGarbageCollect('br_1');
    expect(deleteByBridgeSession).toHaveBeenCalledWith('br_1');
  });
});

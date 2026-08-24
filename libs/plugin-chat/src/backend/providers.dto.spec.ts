import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProviderDto } from './providers.dto';

// Covers the wire contract #220 depends on: `apiKey: null` is the ONLY way a
// client can ask for the stored secret to be dropped, and it has to survive the
// global pipe (`transform: true, whitelist: true`, apps/backend/src/main.ts) to
// reach the service — where null and undefined mean opposite things. The service
// specs call `update()` directly, so nothing else proves the null gets that far.
describe('UpdateProviderDto — apiKey removal signal', () => {
  const transform = (plain: unknown): UpdateProviderDto =>
    plainToInstance(UpdateProviderDto, plain, {
      // The two options the global ValidationPipe applies.
      excludeExtraneousValues: false,
      exposeDefaultValues: true,
    });

  it('keeps an explicit null on the instance rather than dropping the key', async () => {
    const dto = transform({ apiKey: null });
    expect(await validate(dto)).toHaveLength(0);
    // The distinction the service reads: present-and-null ≠ absent.
    expect('apiKey' in dto).toBe(true);
    expect(dto.apiKey).toBeNull();
  });

  it('leaves apiKey absent when the client omits it', async () => {
    const dto = transform({ name: 'o' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.apiKey).toBeUndefined();
  });

  it('still accepts a blank string, which means "keep the stored secret"', async () => {
    const dto = transform({ apiKey: '' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.apiKey).toBe('');
  });

  it('still rejects a non-string, non-null apiKey', async () => {
    const errors = await validate(transform({ apiKey: 42 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('still enforces the length bound on a real key', async () => {
    const errors = await validate(transform({ apiKey: 'k'.repeat(501) }));
    expect(errors.length).toBeGreaterThan(0);
  });
});

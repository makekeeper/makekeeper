import {
  ExternalBreakerService,
  SURFACE_BUDGET_MS,
} from './external-breaker.service';
import { ExternalSettingsService } from './external-settings.service';

describe('ExternalBreakerService', () => {
  let breaker: ExternalBreakerService;

  beforeEach(() => {
    // No overrides stored: budgetFor() falls through to the code defaults,
    // which is all the breaker itself needs for these tests — Prisma is never
    // touched because onModuleInit() is not run here.
    const settings = new ExternalSettingsService(
      {} as unknown as ConstructorParameters<typeof ExternalSettingsService>[0],
    );
    breaker = new ExternalBreakerService(settings);
  });

  it("gives guest surfaces a much tighter budget than the plugin's own screen", () => {
    // The whole point of decision #8: a widget may not hold someone else's
    // page hostage for as long as the user's own destination may take.
    expect(SURFACE_BUDGET_MS.widget).toBeLessThan(SURFACE_BUDGET_MS.screen);
    expect(SURFACE_BUDGET_MS.slot).toBe(SURFACE_BUDGET_MS.widget);
    expect(breaker.budget('screen')).toBe(SURFACE_BUDGET_MS.screen);
  });

  it('stays closed below the failure threshold', () => {
    breaker.recordFailure('demo');
    breaker.recordFailure('demo');
    expect(breaker.shouldSkip('demo')).toBe(false);
    expect(breaker.status('demo').open).toBe(false);
  });

  it('opens after three consecutive failures and short-circuits calls', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('demo');
    expect(breaker.status('demo').open).toBe(true);
    expect(breaker.shouldSkip('demo')).toBe(true);
  });

  it('lets exactly one probe through after the cooldown', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00Z'));
    for (let i = 0; i < 3; i++) breaker.recordFailure('demo');
    expect(breaker.shouldSkip('demo')).toBe(true);

    jest.setSystemTime(new Date('2026-07-29T00:01:30Z'));
    // First call after the cooldown is the probe…
    expect(breaker.shouldSkip('demo')).toBe(false);
    // …and everything behind it still short-circuits until the probe lands.
    expect(breaker.shouldSkip('demo')).toBe(true);
    jest.useRealTimers();
  });

  it('closes on success and forgets the failure count', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('demo');
    breaker.recordSuccess('demo');
    expect(breaker.status('demo')).toEqual({
      open: false,
      failures: 0,
      retryAt: null,
    });
    expect(breaker.shouldSkip('demo')).toBe(false);
  });

  it('re-arms the cooldown when a probe fails', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T00:00:00Z'));
    for (let i = 0; i < 3; i++) breaker.recordFailure('demo');
    jest.setSystemTime(new Date('2026-07-29T00:01:30Z'));
    expect(breaker.shouldSkip('demo')).toBe(false); // probe
    breaker.recordFailure('demo'); // probe failed
    expect(breaker.shouldSkip('demo')).toBe(true);
    jest.useRealTimers();
  });

  it('forgets a plugin entirely (uninstall / reinstall starts clean)', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('demo');
    breaker.forget('demo');
    expect(breaker.shouldSkip('demo')).toBe(false);
  });

  it('keeps plugins independent', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('broken');
    expect(breaker.shouldSkip('broken')).toBe(true);
    expect(breaker.shouldSkip('healthy')).toBe(false);
  });
});

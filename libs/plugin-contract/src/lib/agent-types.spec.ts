import {
  PermissionLevel,
  defaultConfirmationPolicy,
  hasRecognitionProvenance,
  requiresConfirmation,
} from './agent-types';

describe('defaultConfirmationPolicy', () => {
  it('auto-runs reads and gates every mutation', () => {
    expect(defaultConfirmationPolicy(PermissionLevel.READ)).toBe('AUTO');
    expect(defaultConfirmationPolicy(PermissionLevel.WRITE)).toBe('CONFIRM');
    expect(defaultConfirmationPolicy(PermissionLevel.DESTRUCTIVE)).toBe(
      'CONFIRM',
    );
  });
});

describe('requiresConfirmation (#72 provenance gate)', () => {
  it('always confirms DESTRUCTIVE, whatever the policy or provenance', () => {
    expect(
      requiresConfirmation({
        policy: 'AUTO',
        permission: PermissionLevel.DESTRUCTIVE,
      }),
    ).toBe(true);
  });

  it('confirms whenever the stored policy is CONFIRM', () => {
    expect(
      requiresConfirmation({
        policy: 'CONFIRM',
        permission: PermissionLevel.WRITE,
      }),
    ).toBe(true);
  });

  it('keeps a manual, image-free WRITE relaxed to AUTO frictionless', () => {
    expect(
      requiresConfirmation({
        policy: 'AUTO',
        permission: PermissionLevel.WRITE,
      }),
    ).toBe(false);
  });

  it('forces an AUTO WRITE to confirm when its tool is recognition-origin', () => {
    expect(
      requiresConfirmation({
        policy: 'AUTO',
        permission: PermissionLevel.WRITE,
        recognitionOrigin: true,
      }),
    ).toBe(true);
  });

  it('forces an AUTO WRITE to confirm when the turn acts on a photo', () => {
    expect(
      requiresConfirmation({
        policy: 'AUTO',
        permission: PermissionLevel.WRITE,
        visionTurn: true,
      }),
    ).toBe(true);
  });

  it('never gates a READ, even inside a vision turn', () => {
    expect(
      requiresConfirmation({
        policy: 'AUTO',
        permission: PermissionLevel.READ,
        visionTurn: true,
        recognitionOrigin: true,
      }),
    ).toBe(false);
  });
});

describe('hasRecognitionProvenance (#72)', () => {
  it('flags a WRITE acting on a photo turn', () => {
    expect(
      hasRecognitionProvenance({
        permission: PermissionLevel.WRITE,
        visionTurn: true,
      }),
    ).toBe(true);
  });

  it('flags a WRITE whose tool is recognition-origin', () => {
    expect(
      hasRecognitionProvenance({
        permission: PermissionLevel.WRITE,
        recognitionOrigin: true,
      }),
    ).toBe(true);
  });

  it('flags a DESTRUCTIVE with recognition provenance too', () => {
    expect(
      hasRecognitionProvenance({
        permission: PermissionLevel.DESTRUCTIVE,
        visionTurn: true,
      }),
    ).toBe(true);
  });

  it('is false for a manual, image-free WRITE', () => {
    expect(
      hasRecognitionProvenance({ permission: PermissionLevel.WRITE }),
    ).toBe(false);
  });

  it('is false for any READ, whatever the input', () => {
    expect(
      hasRecognitionProvenance({
        permission: PermissionLevel.READ,
        visionTurn: true,
        recognitionOrigin: true,
      }),
    ).toBe(false);
  });
});

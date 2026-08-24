import {
  KeyringService,
  decryptSecret,
  encryptSecret,
  generateDek,
} from '@makekeeper/backend-core';
import { KeyringSessionService } from './keyring-session.service';

// Validates the DEK lifecycle without a live DB: an in-memory fake stands in for
// the UserKeyring/KeySession tables. The security properties under test:
//   - a DEK is armed on provision and recoverable on login with the password;
//   - the stored wraps never expose the DEK to someone without password/secret;
//   - a session key re-arms the DEK after the in-memory ring is cleared.
describe('KeyringSessionService', () => {
  let keyring: KeyringService;
  let service: KeyringSessionService;
  let userKeyringRow: { userId: string; wrappedDekPassword: string } | null;
  let keySessionRows: Map<
    string,
    { id: string; userId: string; wrappedDekSession: string; expiresAt: Date }
  >;

  beforeEach(() => {
    keyring = new KeyringService();
    userKeyringRow = null;
    keySessionRows = new Map();

    const prisma = {
      userKeyring: {
        findUnique: ({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            userKeyringRow && userKeyringRow.userId === where.userId
              ? userKeyringRow
              : null,
          ),
        upsert: ({
          create,
        }: {
          create: { userId: string; wrappedDekPassword: string };
        }) => {
          userKeyringRow = create;
          return Promise.resolve(create);
        },
        update: ({
          where,
          data,
        }: {
          where: { userId: string };
          data: { wrappedDekPassword: string };
        }) => {
          if (userKeyringRow && userKeyringRow.userId === where.userId) {
            userKeyringRow.wrappedDekPassword = data.wrappedDekPassword;
          }
          return Promise.resolve(userKeyringRow);
        },
      },
      keySession: {
        create: ({
          data,
        }: {
          data: {
            id: string;
            userId: string;
            wrappedDekSession: string;
            expiresAt: Date;
          };
        }) => {
          keySessionRows.set(data.id, data);
          return Promise.resolve(data);
        },
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(keySessionRows.get(where.id) ?? null),
        delete: ({ where }: { where: { id: string } }) => {
          keySessionRows.delete(where.id);
          return Promise.resolve();
        },
        deleteMany: () => Promise.resolve({ count: 0 }),
        updateMany: ({
          where,
          data,
        }: {
          where: { id: string; wrappedDekSession: string };
          data: { wrappedDekSession: string; expiresAt: Date };
        }) => {
          const row = keySessionRows.get(where.id);
          if (!row || row.wrappedDekSession !== where.wrappedDekSession) {
            return Promise.resolve({ count: 0 });
          }
          row.wrappedDekSession = data.wrappedDekSession;
          row.expiresAt = data.expiresAt;
          return Promise.resolve({ count: 1 });
        },
      },
    };
    const config = { getJwtTtlSeconds: () => 3600 };

    service = new KeyringSessionService(
      prisma as never,
      keyring,
      config as never,
    );
  });

  it('arms a DEK on provision and stores it wrapped (not in clear)', async () => {
    const sessionKey = await service.provision('u1', 'password-1');
    expect(keyring.isArmed('u1')).toBe(true);
    const dek = keyring.getDek('u1');
    expect(dek).toBeTruthy();
    // The stored password wrap must not contain the DEK verbatim, and must be
    // recoverable only with the password.
    expect(userKeyringRow?.wrappedDekPassword).not.toContain(dek as string);
    expect(
      decryptSecret(userKeyringRow?.wrappedDekPassword ?? '', 'password-1'),
    ).toBe(dek);
    expect(sessionKey).toContain(':');
  });

  it('recovers the same DEK on login with the correct password', async () => {
    await service.provision('u1', 'password-1');
    const dek = keyring.getDek('u1');
    keyring.clear();
    expect(keyring.isArmed('u1')).toBe(false);

    const sessionKey = await service.unlock('u1', 'password-1');
    expect(sessionKey).toBeTruthy();
    expect(keyring.getDek('u1')).toBe(dek);
  });

  it('re-keys when the stored wrap no longer opens (admin password reset)', async () => {
    // unlock() runs only after the bcrypt check passes, so an unwrap failure
    // means the password changed out of band without a rewrap. Per #63 the old
    // DEK is unrecoverable, so the account is re-keyed rather than left locked.
    await service.provision('u1', 'password-1');
    const oldDek = keyring.getDek('u1');
    keyring.clear();

    const sessionKey = await service.unlock('u1', 'new-password');
    expect(sessionKey).toBeTruthy();
    expect(keyring.isArmed('u1')).toBe(true);
    const newDek = keyring.getDek('u1');
    expect(newDek).toBeTruthy();
    expect(newDek).not.toBe(oldDek);
    // The fresh wrap opens with the new password, not the old one.
    expect(
      decryptSecret(userKeyringRow?.wrappedDekPassword ?? '', 'new-password'),
    ).toBe(newDek);
    expect(
      decryptSecret(userKeyringRow?.wrappedDekPassword ?? '', 'password-1'),
    ).toBeNull();
  });

  it('wraps the password DEK with the hardened KDF (v2) on provision (#242)', async () => {
    await service.provision('u1', 'weak-pw');
    expect(userKeyringRow?.wrappedDekPassword.startsWith('v2:')).toBe(true);
  });

  it('upgrades a legacy v1 password wrap to v2 on the next unlock (#242)', async () => {
    // Seed a wrap made the old way (default KDF, v1), as an existing account
    // would carry it. It must still unlock, then be rewritten as v2.
    const dek = generateDek();
    userKeyringRow = {
      userId: 'u1',
      wrappedDekPassword: encryptSecret(dek, 'weak-pw'),
    };
    expect(userKeyringRow.wrappedDekPassword.startsWith('v1:')).toBe(true);

    await service.unlock('u1', 'weak-pw');

    expect(userKeyringRow.wrappedDekPassword.startsWith('v2:')).toBe(true);
    // Same DEK, still recoverable with the same password after the upgrade.
    expect(decryptSecret(userKeyringRow.wrappedDekPassword, 'weak-pw')).toBe(
      dek,
    );
    expect(keyring.getDek('u1')).toBe(dek);
  });

  it('re-arms the DEK from the session key after a cold start', async () => {
    const sessionKey = await service.provision('u1', 'password-1');
    const dek = keyring.getDek('u1');
    keyring.clear();

    await service.rearmFromSessionKey('u1', sessionKey);
    expect(keyring.getDek('u1')).toBe(dek);
  });

  it('consumes the presented key on re-arm and returns a working replacement (#243)', async () => {
    const sessionKey = await service.provision('u1', 'password-1');
    const dek = keyring.getDek('u1');
    keyring.clear();

    const rotated = await service.rearmFromSessionKey('u1', sessionKey);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(sessionKey);

    // The consumed key is dead — a captured copy cannot re-arm again…
    keyring.clear();
    await expect(
      service.rearmFromSessionKey('u1', sessionKey),
    ).resolves.toBeNull();
    expect(keyring.isArmed('u1')).toBe(false);

    // …while the replacement re-arms the same DEK (and rotates once more).
    const again = await service.rearmFromSessionKey('u1', rotated as string);
    expect(keyring.getDek('u1')).toBe(dek);
    expect(again).toBeTruthy();
    expect(again).not.toBe(rotated);
  });

  it('ignores a session key belonging to a different user', async () => {
    const sessionKey = await service.provision('u1', 'password-1');
    keyring.clear();
    await service.rearmFromSessionKey('someone-else', sessionKey);
    expect(keyring.isArmed('someone-else')).toBe(false);
  });

  it('does not re-arm from a tampered session secret', async () => {
    const sessionKey = await service.provision('u1', 'password-1');
    keyring.clear();
    const [id] = sessionKey.split(':');
    await service.rearmFromSessionKey('u1', `${id}:tampered-secret`);
    expect(keyring.isArmed('u1')).toBe(false);
  });

  it('provisions a legacy user (no keyring row) on first login', async () => {
    // No provision() beforehand — simulates an account created before #63.
    const sessionKey = await service.unlock('legacy', 'password-x');
    expect(sessionKey).toBeTruthy();
    expect(keyring.isArmed('legacy')).toBe(true);
    expect(userKeyringRow?.userId).toBe('legacy');
  });
});

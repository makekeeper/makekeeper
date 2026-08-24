import { isMobileShellPath, parsePairingHandoff } from './mobile';

// The re-pairing scan (#207) reads the code back out of the very QR the desktop
// paints — so the shape of that URL is now a contract with a test, not a string
// two files happen to agree on.

describe('parsePairingHandoff', () => {
  it('unwraps the code from the pairing URL the QR carries', () => {
    expect(
      parsePairingHandoff('https://mk.example.com/m/pair?code=ABC123'),
    ).toEqual({ code: 'ABC123', locale: null });
  });

  it('accepts the surface published under a path prefix', () => {
    expect(
      parsePairingHandoff('https://example.com/app/m/pair?code=xyz'),
    ).toEqual({ code: 'xyz', locale: null });
  });

  it('carries the language the desktop painted into the QR', () => {
    // Scanning from inside the app never navigates, so this is the only place
    // the language can be recovered from (#211).
    expect(
      parsePairingHandoff('https://mk.example.com/m/pair?code=ABC123&lang=ru'),
    ).toEqual({ code: 'ABC123', locale: 'ru' });
  });

  it('still pairs when the language is one we ship no bundle for', () => {
    // A code is a credential and a language is a preference: junk in the second
    // must never cost the first.
    expect(
      parsePairingHandoff('https://mk.example.com/m/pair?code=ABC123&lang=de'),
    ).toEqual({ code: 'ABC123', locale: null });
  });

  it('refuses a bare word, however code-shaped', () => {
    // The camera decodes CODE_128 and EAN too — our own shelf labels. Accepting
    // a bare token would let one that drifted into frame close the camera and
    // spend the pairing attempt on something that was never a credential.
    expect(parsePairingHandoff('  ABC-123  ')).toBeNull();
    expect(parsePairingHandoff('4006381333931')).toBeNull();
  });

  it('refuses a URL of ours that carries no code', () => {
    expect(parsePairingHandoff('https://mk.example.com/m/pair')).toBeNull();
  });

  it('refuses a URL that is not the pairing route', () => {
    // A phone-bridge QR, a shelf label, someone elses ticket — none of them is
    // a credential, and treating one as such would burn a real pairing attempt.
    expect(
      parsePairingHandoff('https://mk.example.com/d/session-token?code=ABC123'),
    ).toBeNull();
  });

  it('refuses whatever else happened to be in frame', () => {
    expect(parsePairingHandoff('')).toBeNull();
    expect(parsePairingHandoff('   ')).toBeNull();
    expect(parsePairingHandoff('WIFI:S=home;T=WPA;P=hunter2;;')).toBeNull();
    expect(parsePairingHandoff('some words')).toBeNull();
  });
});

describe('isMobileShellPath', () => {
  it('claims the shell root and everything below it', () => {
    expect(isMobileShellPath('/m')).toBe(true);
    expect(isMobileShellPath('/m/pair')).toBe(true);
    expect(isMobileShellPath('/m/intake/drafts')).toBe(true);
  });

  it('does not claim a desktop page that merely starts with the same letter', () => {
    expect(isMobileShellPath('/manual')).toBe(false);
    expect(isMobileShellPath('/')).toBe(false);
    expect(isMobileShellPath('/inventory')).toBe(false);
  });
});

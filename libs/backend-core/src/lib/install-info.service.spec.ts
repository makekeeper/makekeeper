import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { AppConfigService } from './app-config.service';
import { InstallInfoService } from './install-info.service';

// `/.dockerenv` is the container signal; mock it so the branches can be driven
// from the test instead of the host the suite happens to run on.
jest.mock('fs', () => ({ existsSync: jest.fn() }));

const existsSyncMock = existsSync as jest.MockedFunction<typeof existsSync>;

describe('InstallInfoService.getInstallInfo', () => {
  const savedEnv = { ...process.env };
  let service: InstallInfoService;

  beforeEach(() => {
    // The real config service — it is a thin typed reader over process.env, so
    // the env mutations below still drive every branch.
    service = new InstallInfoService(new AppConfigService());
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    delete process.env.MK_INSTALL_METHOD;
    delete process.env.KUBERNETES_SERVICE_HOST;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.clearAllMocks();
  });

  const inContainer = (value: boolean) => existsSyncMock.mockReturnValue(value);

  it('trusts a declared marker over every inferred signal', () => {
    inContainer(true);
    process.env.MK_INSTALL_METHOD = 'dokploy';
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    expect(service.getInstallInfo()).toEqual({
      method: 'dokploy',
      confidence: 'declared',
      container: true,
    });
  });

  it('normalizes marker case and trims surrounding whitespace', () => {
    inContainer(true);
    process.env.MK_INSTALL_METHOD = '  Coolify  ';
    expect(service.getInstallInfo()).toEqual({
      method: 'coolify',
      confidence: 'declared',
      container: true,
    });
  });

  it('accepts a manager that stamps the marker by hand (Portainer)', () => {
    inContainer(true);
    process.env.MK_INSTALL_METHOD = 'portainer';
    expect(service.getInstallInfo()).toEqual({
      method: 'portainer',
      confidence: 'declared',
      container: true,
    });
  });

  it('falls back to detection on an unrecognised marker value', () => {
    inContainer(true);
    process.env.MK_INSTALL_METHOD = 'some-other-panel';
    expect(service.getInstallInfo()).toEqual({
      method: 'unknown',
      confidence: 'guessed',
      container: true,
    });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('treats an explicit "unknown" marker as no marker at all', () => {
    inContainer(false);
    process.env.MK_INSTALL_METHOD = 'unknown';
    expect(service.getInstallInfo()).toEqual({
      method: 'dev',
      confidence: 'inferred',
      container: false,
    });
    // A declared `unknown` is documented behaviour, not a misconfiguration —
    // it must not be logged as one.
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('infers kubernetes from the injected service host', () => {
    inContainer(true);
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    expect(service.getInstallInfo()).toEqual({
      method: 'kubernetes',
      confidence: 'inferred',
      container: true,
    });
  });

  it('infers dev when nothing indicates a container', () => {
    inContainer(false);
    expect(service.getInstallInfo()).toEqual({
      method: 'dev',
      confidence: 'inferred',
      container: false,
    });
  });

  it('guesses unknown for an unmarked container install', () => {
    inContainer(true);
    expect(service.getInstallInfo()).toEqual({
      method: 'unknown',
      confidence: 'guessed',
      container: true,
    });
  });
});

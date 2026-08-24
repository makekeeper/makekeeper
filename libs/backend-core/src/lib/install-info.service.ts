import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import {
  InstallInfo,
  InstallMethod,
  isInstallMethod,
} from '@makekeeper/plugin-contract';
import { AppConfigService } from './app-config.service';

// Detects how this instance was installed (#100). See install-info.ts in
// plugin-contract for why the marker — not sniffing — is the primary signal.
//
// The `/.dockerenv` file is written by the Docker daemon into every container
// it starts; its absence is the cheapest container-vs-dev signal that needs no
// privileged access. `KUBERNETES_SERVICE_HOST` is injected by kubelet into
// every pod, so it identifies a Kubernetes install even without the marker.
const DOCKER_ENV_FILE = '/.dockerenv';

@Injectable()
export class InstallInfoService {
  private readonly logger = new Logger(InstallInfoService.name);

  constructor(private readonly config: AppConfigService) {}

  // First match wins: declared marker → Kubernetes → not containerized (dev) →
  // containerized but unmarked (unknown). An unrecognised marker value is
  // ignored (with a warning) and falls through to the inferred signals, so a
  // typo degrades to a guess instead of poisoning the diagnostic.
  getInstallInfo(): InstallInfo {
    const container = this.isContainerized();

    const declared = this.readDeclaredMethod();
    if (declared) {
      return { method: declared, confidence: 'declared', container };
    }

    if (this.config.getKubernetesServiceHost()) {
      return { method: 'kubernetes', confidence: 'inferred', container };
    }

    if (!container) {
      return { method: 'dev', confidence: 'inferred', container };
    }

    return { method: 'unknown', confidence: 'guessed', container };
  }

  private readDeclaredMethod(): InstallMethod | null {
    const raw = this.config.getInstallMethodMarker();
    if (!raw) return null;
    const normalized = raw.toLowerCase();
    // `unknown` is a legal contract value meaning "the deployment declines to
    // say" — same outcome as no marker, so it falls through silently. Only a
    // value outside the vocabulary is worth warning about.
    if (normalized === 'unknown') return null;
    if (!isInstallMethod(normalized)) {
      this.logger.warn(
        `Ignoring unrecognised MK_INSTALL_METHOD "${raw}" — falling back to detection.`,
      );
      return null;
    }
    return normalized;
  }

  private isContainerized(): boolean {
    return existsSync(DOCKER_ENV_FILE);
  }
}

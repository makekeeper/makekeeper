import { Injectable, Logger } from '@nestjs/common';
import { ExternalSettingsService } from './external-settings.service';
import { ExternalSurface } from './surface-budgets';

// The circuit breaker over the per-surface time budgets (#134, decision #8;
// the budgets themselves live in surface-budgets.ts, admin overrides in
// ExternalSettingsService).
//
// The breaker exists so ONE dead plugin does not add its timeout to every
// dashboard render: after a few consecutive misses the core stops calling it
// for a cooldown and fails instantly, then lets a single probe through.

export type { ExternalSurface } from './surface-budgets';
export { EXTERNAL_SURFACES, SURFACE_BUDGET_MS } from './surface-budgets';

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
  // A probe is in flight: further calls stay short-circuited until it lands,
  // so a recovering plugin gets exactly one request, not a thundering herd.
  probing: boolean;
}

export interface BreakerStatus {
  open: boolean;
  failures: number;
  retryAt: number | null;
}

@Injectable()
export class ExternalBreakerService {
  private readonly logger = new Logger(ExternalBreakerService.name);
  private readonly states = new Map<string, BreakerState>();

  constructor(private readonly settings: ExternalSettingsService) {}

  budget(surface: ExternalSurface): number {
    return this.settings.budgetFor(surface);
  }

  // True when the call must be short-circuited without touching the network.
  shouldSkip(pluginId: string): boolean {
    const state = this.states.get(pluginId);
    if (!state || state.openedAt === null) return false;
    if (Date.now() - state.openedAt < BREAKER_COOLDOWN_MS) return true;
    if (state.probing) return true;
    // Cooldown elapsed: let exactly one probe through.
    state.probing = true;
    return false;
  }

  recordSuccess(pluginId: string): void {
    const state = this.states.get(pluginId);
    if (!state) return;
    if (state.openedAt !== null) {
      this.logger.log(`external plugin recovered: ${pluginId}`);
    }
    this.states.delete(pluginId);
  }

  recordFailure(pluginId: string): void {
    const state = this.states.get(pluginId) ?? {
      failures: 0,
      openedAt: null,
      probing: false,
    };
    state.failures += 1;
    state.probing = false;
    if (state.failures >= BREAKER_THRESHOLD) {
      // Re-arm the cooldown on a failed probe as well as on the initial trip.
      if (state.openedAt === null) {
        this.logger.warn(
          `external plugin breaker opened after ${state.failures} failures: ${pluginId}`,
        );
      }
      state.openedAt = Date.now();
    }
    this.states.set(pluginId, state);
  }

  status(pluginId: string): BreakerStatus {
    const state = this.states.get(pluginId);
    if (!state) return { open: false, failures: 0, retryAt: null };
    return {
      open: state.openedAt !== null,
      failures: state.failures,
      retryAt:
        state.openedAt === null ? null : state.openedAt + BREAKER_COOLDOWN_MS,
    };
  }

  // Uninstall/disable drops the plugin's breaker state so a reinstall starts
  // clean rather than inheriting an open circuit.
  forget(pluginId: string): void {
    this.states.delete(pluginId);
  }
}

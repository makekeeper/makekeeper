import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService, Public } from '@makekeeper/backend-core';

// Container / orchestrator health probes. Three standard signals, each mapped to
// a different orchestrator reaction:
//  - Liveness (`/api/health`, `/api/health/live`): the process + HTTP layer are
//    up. Dependency-free, so a slow or absent dependency never trips it — a
//    failure means "the process is wedged, restart the container". This is also
//    the endpoint the frontend availability monitor polls (#64).
//  - Readiness (`/api/health/ready`): the app can actually serve — its
//    dependencies (the database) are reachable. A failure means "stop routing
//    traffic here" (drain), not necessarily restart. It doubles as a startup
//    probe: it only reports ready once the DB connection is live.
//
// All @Public() so orchestrator probes work without auth and with the multiuser
// overlay both on and off; the responses expose no per-user or instance data.

type DependencyState = 'up' | 'down';

// Machine-readable status only — the values are status enums, never user-facing
// prose, so (unlike a thrown error *message*) they are not i18n keys (§5.5).
interface ReadinessReport {
  status: 'ok' | 'error';
  checks: { database: DependencyState };
}

@Controller('health')
@ApiTags('core')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness — the canonical path the frontend monitor hits and a generic
  // container liveness target.
  @Public()
  @Get()
  getLiveness(): { ok: true } {
    return { ok: true };
  }

  // Kubernetes-style liveness alias, so a livenessProbe and readinessProbe can
  // sit on sibling paths (`/live` vs `/ready`).
  @Public()
  @Get('live')
  getLive(): { ok: true } {
    return { ok: true };
  }

  // Readiness — verifies the database is reachable. 200 when ready; 503 with the
  // same body when a dependency is down, so the orchestrator drains traffic
  // until it recovers instead of killing the container.
  @Public()
  @Get('ready')
  async getReadiness(): Promise<ReadinessReport> {
    const database = await this.pingDatabase();
    const report: ReadinessReport = {
      status: database === 'up' ? 'ok' : 'error',
      checks: { database },
    };
    if (database !== 'up') throw new ServiceUnavailableException(report);
    return report;
  }

  private async pingDatabase(): Promise<DependencyState> {
    try {
      // Cheapest possible round-trip that proves the pool can reach Postgres.
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      // Any failure (pool exhausted, DB down, network) ⇒ not ready.
      return 'down';
    }
  }
}

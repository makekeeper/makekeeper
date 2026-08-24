import { Injectable, Logger } from '@nestjs/common';
import {
  SECRET_ACCESS_EVENT,
  SecretAccessRealtimePayload,
  userRoom,
} from '@makekeeper/plugin-contract';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { RequestContextService } from './request-context.service';
import { generateUuid } from './uuid';
import { getErrorMessage } from './error';

// Records and announces every out-of-session use of a user's personal secret
// (#63). A server operator who controls the process can always read a secret at
// the moment of use, so prevention is impossible; instead each such use is made
// OBSERVABLE — a durable SecretAccessLog row (which the operator cannot silently
// unwrite without leaving the tampering visible) plus a realtime notice to the
// owner. "Out of session" = the actor is not the owner: a workspace guest using
// the owner's shared credentials, or an unattended background job.
@Injectable()
export class SecretAccessService {
  private readonly logger = new Logger(SecretAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly requestContext: RequestContextService,
  ) {}

  // Best-effort: auditing must never break the operation whose secret was used,
  // so failures are logged and swallowed. `purposeKey` is an i18n key (§5.5).
  async recordOutOfSessionUse(input: {
    ownerUserId: string;
    pluginId: string;
    purposeKey: string;
  }): Promise<void> {
    const actorUserId = this.requestContext.get()?.userId ?? null;
    const byGuest = actorUserId !== null;
    const at = new Date();
    try {
      await this.prisma.secretAccessLog.create({
        data: {
          id: generateUuid(),
          ownerUserId: input.ownerUserId,
          actorUserId,
          pluginId: input.pluginId,
          purposeKey: input.purposeKey,
          byGuest,
          createdAt: at,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write secret-access log: ${getErrorMessage(err)}`,
      );
    }
    const payload: SecretAccessRealtimePayload = {
      pluginId: input.pluginId,
      purposeKey: input.purposeKey,
      byGuest,
      at: at.toISOString(),
    };
    this.realtime.emitToRoom(
      userRoom(input.ownerUserId),
      SECRET_ACCESS_EVENT,
      payload,
    );
  }
}

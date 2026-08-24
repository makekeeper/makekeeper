import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma.module';
import { AttachmentStorageService } from './attachment-storage.service';
import { DiskUsageService } from './disk-usage.service';
import { UploadsReservationService } from './uploads-reservation.service';

// Shared upload storage, reused by any plugin that persists attachments (chat,
// capture). AppConfigService is provided globally, so only Prisma is imported.
@Module({
  imports: [PrismaModule],
  providers: [
    AttachmentStorageService,
    DiskUsageService,
    UploadsReservationService,
  ],
  exports: [
    AttachmentStorageService,
    DiskUsageService,
    UploadsReservationService,
  ],
})
export class AttachmentStorageModule {}

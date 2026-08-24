import { Injectable } from '@nestjs/common';
import { PrismaService } from '@makekeeper/backend-core';
import { MultiuserSettingsPublic } from '@makekeeper/plugin-contract';

// Singleton settings row (id "default") — same pattern as PhoneBridgeSettings.
// Cached: the register endpoint consults it on every call.
@Injectable()
export class MultiuserSettingsService {
  private cached: MultiuserSettingsPublic | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<MultiuserSettingsPublic> {
    if (this.cached) return this.cached;
    const row = await this.prisma.multiuserSettings.findUnique({
      where: { id: 'default' },
    });
    this.cached = { allowRegistration: row?.allowRegistration ?? true };
    return this.cached;
  }

  async update(
    patch: Partial<MultiuserSettingsPublic>,
  ): Promise<MultiuserSettingsPublic> {
    const current = await this.get();
    const next = { ...current, ...patch };
    const values = { allowRegistration: next.allowRegistration };
    await this.prisma.multiuserSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...values },
      update: values,
    });
    this.cached = next;
    return next;
  }

  clearCache(): void {
    this.cached = null;
  }
}

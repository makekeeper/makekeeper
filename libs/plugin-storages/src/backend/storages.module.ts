import { Module, OnModuleInit } from '@nestjs/common';
import { storagesManifest } from '../manifest';
import {
  PluginRegistryService,
  AgentRegistryService,
  PluginI18nService,
  PrismaService,
  ScopeRestrictionRegistryService,
  ExchangeRegistryService,
} from '@makekeeper/backend-core';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { StoragesController } from './storages.controller';
import { StoragesService } from './storages.service';

import { getStorageTools } from './storages.tools';
import { createStoragesPageContextResolver } from './storages.context';
import { createStoragesRestriction } from './storages.restrictions';
import { createStoragesExchangeProviders } from './storages.exchange';
import { createTableDumpProvider } from '@makekeeper/backend-core';

@Module({
  controllers: [StoragesController],
  providers: [StoragesService],
  exports: [StoragesService],
})
export class StoragesPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly storagesService: StoragesService,
    private readonly i18n: PluginI18nService,
    private readonly prisma: PrismaService,
    private readonly scopeRestrictions: ScopeRestrictionRegistryService,
    private readonly exchangeRegistry: ExchangeRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(storagesManifest);
    this.i18n.registerBundle({ en, ru });
    // Exchange section provider (#62): the storage root's subtree structure.
    for (const provider of createStoragesExchangeProviders(
      this.prisma,
      this.i18n,
    )) {
      this.exchangeRegistry.registerSectionProvider('storages', provider);
    }
    // Instance backup: the whole tree, parent-first (self-referencing FK).
    this.exchangeRegistry.registerSectionProvider(
      'storages',
      createTableDumpProvider({
        sectionKey: 'storages.all',
        models: [{ name: 'storage', parentKey: 'parentId' }],
        prisma: this.prisma,
      }),
    );
    this.agentRegistry.registerTools(
      getStorageTools(this.storagesService, this.i18n),
    );
    // Server-side page-context resolution: the chat runtime asks this resolver to
    // turn route ids (storageId/row/col) into the exact human description of the
    // user's current selection — see storages.context.ts.
    this.agentRegistry.registerPageContextResolver(
      'storages',
      createStoragesPageContextResolver(this.storagesService, this.i18n),
    );
    // Resolve a storage ORef to its name + breadcrumb; a "#B1" cell fragment is
    // appended to the path so the agent sees exactly which cell was referenced.
    this.agentRegistry.registerObjectRefResolver(
      'storages',
      'storage',
      async (ref) => {
        const breadcrumb = await this.storagesService.getBreadcrumb(
          ref.entityId,
        );
        if (!breadcrumb) return null;
        return {
          displayName: breadcrumb.name,
          breadcrumb: ref.fragment
            ? `${breadcrumb.path} / ${ref.fragment}`
            : breadcrumb.path,
        };
      },
    );
    // Announce "restrict a shared scope to storage subtrees" (multiuser).
    this.scopeRestrictions.register(createStoragesRestriction(this.prisma));
  }
}

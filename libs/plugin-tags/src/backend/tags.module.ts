import { Module, OnModuleInit } from '@nestjs/common';
import {
  AgentRegistryModule,
  AgentRegistryService,
  CapabilityRegistryService,
  ExchangeRegistryService,
  PluginEventBusService,
  PluginI18nService,
  PluginRegistryService,
  PrismaModule,
  PrismaService,
} from '@makekeeper/backend-core';
import {
  INVENTORY_ITEM_PROPERTY_VALUES_EVENT,
  TAGS_ASSIGN_CAPABILITY,
  type InventoryItemPropertyValuesEvent,
  type TagsAssignCapability,
} from '@makekeeper/plugin-contract';
import { tagsManifest } from '../manifest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { TagSourcesService } from './tag-sources.service';
import { getTagsTools } from './tags.tools';
import { createTagsExchangeProviders } from './tags.exchange';
import { createTableDumpProvider } from '@makekeeper/backend-core';

@Module({
  imports: [PrismaModule, AgentRegistryModule],
  controllers: [TagsController],
  providers: [TagsService, TagSourcesService],
  exports: [TagsService, TagSourcesService],
})
export class TagsPluginModule implements OnModuleInit {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly tagsService: TagsService,
    private readonly i18n: PluginI18nService,
    private readonly exchangeRegistry: ExchangeRegistryService,
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly eventBus: PluginEventBusService,
    private readonly tagSources: TagSourcesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(tagsManifest);
    this.i18n.registerBundle({ en, ru });
    // Exchange section provider (#62): tags travel with both entity roots.
    for (const provider of createTagsExchangeProviders(this.prisma)) {
      this.exchangeRegistry.registerSectionProvider('tags', provider);
    }
    // Instance backup: vocabulary + links verbatim.
    this.exchangeRegistry.registerSectionProvider(
      'tags',
      createTableDumpProvider({
        sectionKey: 'tags.all',
        models: ['tag', 'tagLink'],
        prisma: this.prisma,
      }),
    );
    this.agentRegistry.registerTools(getTagsTools(this.tagsService, this.i18n));
    // A tag is itself a referenceable object: resolve mk://tags/tag/<id> to its
    // name so tag refs render as links and appear in the generic resolve tool.
    this.agentRegistry.registerObjectRefResolver('tags', 'tag', async (ref) => {
      const tag = await this.tagsService.findOne(ref.entityId);
      return tag ? { displayName: tag.name } : null;
    });
    // Fields whose value becomes a tag (#205). Inventory announces what a new
    // item was filled in with and knows nothing about tags; the decision that
    // some of those values are worth tagging is made here, against this
    // plugin's own table. The bus skips this listener while tags is disabled,
    // so the feature disappears with the plugin and nothing in the emitter has
    // to ask whether it is there (§5.10).
    this.eventBus.on<InventoryItemPropertyValuesEvent>(
      'tags',
      INVENTORY_ITEM_PROPERTY_VALUES_EVENT,
      (event) => this.tagSources.onItemPropertyValues(event),
    );
    // "Tag this object" offered outright, for a caller that already knows what
    // it wants tagged. Not used by the tag-source path above.
    this.capabilities.registerCapability<TagsAssignCapability>(
      'tags',
      TAGS_ASSIGN_CAPABILITY,
      {
        assignTag: async (name, ref) => {
          await this.tagsService.assign(name, ref);
        },
      },
    );
  }
}

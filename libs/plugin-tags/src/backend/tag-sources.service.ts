import { Injectable, Logger } from '@nestjs/common';
import {
  PluginI18nService,
  PrismaService,
  generateUuid,
  getErrorMessage,
} from '@makekeeper/backend-core';
import {
  parseObjectRef,
  type InventoryItemPropertyValuesEvent,
} from '@makekeeper/plugin-contract';
import { TagsService } from './tags.service';

// "The value of this field becomes a tag on whatever carries it" (#205).
//
// The marking lives HERE, not on the field's own row in the plugin that owns
// it. That plugin announces what an object was filled in with and is done; this
// service is the only place that knows any of it is about tags. Disable this
// plugin and the marking stops applying, the control that sets it disappears
// with the plugin's frontend, and the host is unchanged — which is the whole
// point of doing it this way round (§5.10).
//
// A field is named by its canonical ORef, exactly like a TagLink's target, so
// this table has no foreign key into anybody's schema.

@Injectable()
export class TagSourcesService {
  private readonly logger = new Logger(TagSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tags: TagsService,
    private readonly i18n: PluginI18nService,
  ) {}

  // Whether each of these fields is a tag source. Answered in one call because
  // the caller is a list of rows, and one request per row is how a screen with
  // twenty properties makes twenty requests.
  async statusFor(refs: string[]): Promise<Record<string, boolean>> {
    const rows = await this.prisma.tagSource.findMany({
      where: { ref: { in: refs } },
      select: { ref: true },
    });
    const marked = new Set(rows.map((row) => row.ref));
    return Object.fromEntries(refs.map((ref) => [ref, marked.has(ref)]));
  }

  // Idempotent both ways: the control that calls this is a switch, and a switch
  // that errors when it already agrees with you is a broken switch.
  async setSource(
    ref: string,
    isSource: boolean,
    locale?: string,
  ): Promise<void> {
    if (!parseObjectRef(ref)) {
      throw new Error(this.i18n.t('tags.errors.invalidRef', { ref }, locale));
    }
    if (!isSource) {
      await this.prisma.tagSource.deleteMany({ where: { ref } });
      return;
    }
    const existing = await this.prisma.tagSource.findFirst({ where: { ref } });
    if (existing) return;
    await this.prisma.tagSource.create({
      data: { id: generateUuid(), ref },
    });
  }

  // The listener. An item was created somewhere with these values; tag it with
  // the ones whose field this plugin has marked.
  //
  // Never re-runs: the host announces at creation only, so a tag placed from a
  // value stays where it was put and a tag removed by hand stays removed.
  async onItemPropertyValues(
    event: InventoryItemPropertyValuesEvent,
  ): Promise<void> {
    const refs = event.values.map((entry) => entry.propertyRef);
    if (!refs.length) return;
    const status = await this.statusFor(refs);
    const names = event.values
      .filter((entry) => status[entry.propertyRef])
      .map((entry) => entry.value.trim())
      .filter((name) => name !== '');
    for (const name of names) {
      try {
        await this.tags.assign(name, event.itemRef);
      } catch (err) {
        // One unusable value must not cost the item its other tags. The bus
        // already keeps a throw here from reaching the emitter; this keeps it
        // from reaching the next name.
        this.logger.warn(
          `Tagging ${event.itemRef} with "${name}" failed: ${getErrorMessage(err)}`,
        );
      }
    }
  }
}

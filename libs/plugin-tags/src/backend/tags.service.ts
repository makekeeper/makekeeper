import { Injectable } from '@nestjs/common';
import type { Tag } from '@prisma/client';
import {
  AgentRegistryService,
  PluginI18nService,
  PrismaService,
  generateUuid,
} from '@makekeeper/backend-core';
import {
  formatObjectRef,
  hasObjectRefScheme,
  parseObjectRef,
  resolveEntityId,
} from '@makekeeper/plugin-contract';
import { DEFAULT_TAG_COLOR, isTagColorValue } from '../tag-colors';
import {
  TAG_NAME_MAX,
  type TagDto,
  type TaggedObjectDto,
  type TagsForRefsResult,
} from '../tags-types';

// A Tag row plus the count of objects it is attached to.
type TagWithCount = Tag & { _count: { links: number } };

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly i18n: PluginI18nService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  // All tags (optionally name-filtered for autocomplete), each with its usage
  // count. Scoping is applied by the DB policy; a tag's links are same-scope by
  // construction, so the relation `_count` equals the in-scope count.
  async listTags(query?: string): Promise<TagDto[]> {
    const trimmed = query?.trim();
    const tags = await this.prisma.tag.findMany({
      where: trimmed
        ? { name: { contains: trimmed, mode: 'insensitive' } }
        : undefined,
      include: { _count: { select: { links: true } } },
      orderBy: { name: 'asc' },
    });
    return tags.map((tag) => this.toTagDto(tag, tag._count.links));
  }

  async findOne(id: string): Promise<Tag | null> {
    return this.prisma.tag.findFirst({ where: { id } });
  }

  // Tags attached to each of the given object refs, keyed by ref. One query for
  // the whole batch — drives the chip slot across a list of rows.
  async tagsForRefs(refs: string[]): Promise<TagsForRefsResult> {
    const result: TagsForRefsResult = {};
    if (refs.length === 0) return result;
    const links = await this.prisma.tagLink.findMany({
      where: { ref: { in: refs } },
      include: {
        tag: { include: { _count: { select: { links: true } } } },
      },
    });
    for (const link of links) {
      const dto = this.toTagDto(link.tag, link.tag._count.links);
      (result[link.ref] ??= []).push(dto);
    }
    for (const ref of Object.keys(result)) {
      result[ref].sort((a, b) => a.name.localeCompare(b.name));
    }
    return result;
  }

  // Objects a tag is attached to, resolved to name + breadcrumb via the owning
  // plugins' ORef resolvers. Links whose target no longer exists are pruned
  // (lazy cleanup — there is no cross-plugin delete event to listen to); links
  // whose owning plugin is currently disabled are returned as "unavailable".
  async objectsForTag(tagId: string): Promise<TaggedObjectDto[]> {
    const links = await this.prisma.tagLink.findMany({
      where: { tagId },
      orderBy: { createdAt: 'asc' },
    });
    const out: TaggedObjectDto[] = [];
    const stale: string[] = [];
    for (const link of links) {
      const resolved = await this.agentRegistry.resolveObjectRef(link.ref);
      if (resolved === null) {
        // Unparseable, no resolver, or the owning plugin is disabled — we can't
        // confirm non-existence, so keep the link and mark it unavailable.
        out.push({ ref: link.ref, displayName: null, breadcrumb: null });
      } else if (!resolved.exists) {
        stale.push(link.id);
      } else {
        out.push({
          ref: link.ref,
          displayName: resolved.displayName,
          breadcrumb: resolved.breadcrumb ?? null,
        });
      }
    }
    if (stale.length > 0) {
      await this.prisma.tagLink.deleteMany({ where: { id: { in: stale } } });
    }
    return out;
  }

  // The raw ORef strings a tag is attached to — consumed by list-view filters,
  // which map them to entity ids client-side.
  async refsForTag(tagId: string): Promise<string[]> {
    const links = await this.prisma.tagLink.findMany({
      where: { tagId },
      select: { ref: true },
    });
    return links.map((link) => link.ref);
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  // Mutations take the caller's locale (x-locale header, threaded from the
  // controller) so thrown errors surface in the user's language; agent-tool
  // callers omit it and resolve at the default locale (§5.5).
  async createTag(
    input: { name: string; color?: string },
    locale?: string,
  ): Promise<TagDto> {
    const name = this.validName(input.name, locale);
    const existing = await this.findTagByName(name);
    if (existing) {
      throw new Error(
        this.i18n.t('tags.errors.duplicateName', { name }, locale),
      );
    }
    const tag = await this.prisma.tag.create({
      data: {
        id: generateUuid(),
        name,
        color: this.normalizeColor(input.color),
      },
    });
    return this.toTagDto(tag, 0);
  }

  async updateTag(
    id: string,
    input: { name?: string; color?: string },
    locale?: string,
  ): Promise<TagDto> {
    const tag = await this.prisma.tag.findFirst({ where: { id } });
    if (!tag) {
      throw new Error(this.i18n.t('tags.errors.notFound', undefined, locale));
    }
    const data: { name?: string; color?: string } = {};
    if (input.name !== undefined) {
      const name = this.validName(input.name, locale);
      const clash = await this.findTagByName(name);
      if (clash && clash.id !== id) {
        throw new Error(
          this.i18n.t('tags.errors.duplicateName', { name }, locale),
        );
      }
      data.name = name;
    }
    if (input.color !== undefined)
      data.color = this.normalizeColor(input.color);
    const updated = await this.prisma.tag.update({ where: { id }, data });
    const count = await this.prisma.tagLink.count({ where: { tagId: id } });
    return this.toTagDto(updated, count);
  }

  async deleteTag(id: string, locale?: string): Promise<void> {
    const tag = await this.prisma.tag.findFirst({ where: { id } });
    if (!tag) {
      throw new Error(this.i18n.t('tags.errors.notFound', undefined, locale));
    }
    // Cascade (schema onDelete: Cascade) removes the tag's links.
    await this.prisma.tag.delete({ where: { id } });
  }

  // Attach a tag to an object. `tagInput` is a tag id, name (created on the fly
  // when unknown), or a tags ORef. The target must be a valid ORef that resolves
  // to an existing, in-scope object (its owning plugin's scoped resolver proves
  // scope consistency). Idempotent on the (tag, ref) unique pair.
  async assign(
    tagInput: string,
    ref: string,
    locale?: string,
  ): Promise<TagDto> {
    if (!parseObjectRef(ref)) {
      throw new Error(this.i18n.t('tags.errors.invalidRef', { ref }, locale));
    }
    const resolved = await this.agentRegistry.resolveObjectRef(ref);
    if (!resolved || !resolved.exists) {
      throw new Error(
        this.i18n.t('tags.errors.targetNotFound', { ref }, locale),
      );
    }
    const tag = await this.resolveTagInput(tagInput, locale);
    const existing = await this.prisma.tagLink.findFirst({
      where: { tagId: tag.id, ref },
    });
    if (!existing) {
      await this.prisma.tagLink.create({
        data: { id: generateUuid(), tagId: tag.id, ref },
      });
    }
    const count = await this.prisma.tagLink.count({ where: { tagId: tag.id } });
    return this.toTagDto(tag, count);
  }

  async unassign(tagIdInput: string, ref: string): Promise<void> {
    const tagId = this.refTagId(tagIdInput) ?? tagIdInput;
    await this.prisma.tagLink.deleteMany({ where: { tagId, ref } });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Resolve a tag id / name / ORef to a Tag, creating it when a bare unknown
  // name is given (create-on-type). Only the assign path wants this side effect;
  // read/update/delete callers use findTag/requireTag instead.
  async resolveTagInput(input: string, locale?: string): Promise<Tag> {
    const found = await this.findTag(input);
    if (found) return found;
    // A tags ORef that didn't resolve is a hard miss (never a name); only a
    // plain unknown name creates a tag.
    if (hasObjectRefScheme(input)) {
      throw new Error(this.i18n.t('tags.errors.notFound', undefined, locale));
    }
    return this.findByNameOrCreate(input, locale);
  }

  // Resolve a tag id / name / ORef to an existing Tag without creating one.
  async findTag(input: string): Promise<Tag | null> {
    const refId = this.refTagId(input);
    if (refId) {
      return this.prisma.tag.findFirst({ where: { id: refId } });
    }
    const byId = await this.prisma.tag.findFirst({ where: { id: input } });
    if (byId) return byId;
    return this.findTagByName(input.trim());
  }

  async requireTag(input: string, locale?: string): Promise<Tag> {
    const tag = await this.findTag(input);
    if (!tag) {
      throw new Error(this.i18n.t('tags.errors.notFound', undefined, locale));
    }
    return tag;
  }

  // Read-only display name for a tag id / ORef / name — never creates (used by
  // agent-tool confirmation cards, which run before execution). Falls back to the
  // raw input (assumed a name) when nothing matches.
  async resolveTagName(input: string): Promise<string> {
    const id = this.refTagId(input) ?? input;
    const byId = await this.prisma.tag.findFirst({ where: { id } });
    return byId?.name ?? input;
  }

  // Tags attached to one object ref (agent READ tool).
  async tagsForRef(ref: string): Promise<TagDto[]> {
    const map = await this.tagsForRefs([ref]);
    return map[ref] ?? [];
  }

  // The id embedded in an mk://tags/tag/<id> ORef, or null when the input is not an
  // ORef (a raw id or a name — disambiguated by the caller).
  private refTagId(input: string): string | null {
    return (
      resolveEntityId(hasObjectRefScheme(input) ? input : '', {
        pluginId: 'tags',
        entityType: 'tag',
      })?.id ?? null
    );
  }

  // Trimmed, non-empty, length-capped tag name — the ONE validation for every
  // create/rename path. The DTO enforces the same cap on controller input, but
  // create-on-assign (a 256-char `tag` field may be a new name) and the agent
  // tools reach here without it.
  private validName(raw: string, locale?: string): string {
    const name = raw.trim();
    if (!name) {
      throw new Error(this.i18n.t('tags.errors.emptyName', undefined, locale));
    }
    if (name.length > TAG_NAME_MAX) {
      throw new Error(
        this.i18n.t('tags.errors.nameTooLong', { max: TAG_NAME_MAX }, locale),
      );
    }
    return name;
  }

  private async findByNameOrCreate(
    name: string,
    locale?: string,
  ): Promise<Tag> {
    const trimmed = this.validName(name, locale);
    const existing = await this.findTagByName(trimmed);
    if (existing) return existing;
    return this.prisma.tag.create({
      data: { id: generateUuid(), name: trimmed, color: DEFAULT_TAG_COLOR },
    });
  }

  private async findTagByName(name: string): Promise<Tag | null> {
    return this.prisma.tag.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  }

  // A colour is a palette tone or a "#rrggbb" hex; anything else falls back to
  // the default (defensive — the DTO already constrains controller input).
  private normalizeColor(value: string | undefined): string {
    return value !== undefined && isTagColorValue(value)
      ? value
      : DEFAULT_TAG_COLOR;
  }

  private toTagDto(
    tag: Pick<Tag, 'id' | 'name' | 'color'>,
    usageCount: number,
  ): TagDto {
    const ref = formatObjectRef({
      pluginId: 'tags',
      entityType: 'tag',
      entityId: tag.id,
    });
    return {
      id: tag.id,
      name: tag.name,
      color: isTagColorValue(tag.color) ? tag.color : DEFAULT_TAG_COLOR,
      usageCount,
      // A persisted id always yields a valid ORef; the fallback keeps types honest.
      ref: ref ?? '',
    };
  }
}

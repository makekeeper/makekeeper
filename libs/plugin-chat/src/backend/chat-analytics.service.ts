import { Injectable } from '@nestjs/common';
import {
  AgentRegistryService,
  PrismaService,
  type StatsPoint,
} from '@makekeeper/backend-core';
import {
  PermissionLevel,
  extractObjectRefs,
  formatObjectRef,
} from '@makekeeper/plugin-contract';
import {
  JournalEntry,
  JournalStatus,
  MessageSearchResult,
  ProjectJournal,
  ProjectUsage,
  MESSAGE_PREFIX,
} from './chat.types';
import { deriveSessionTitle, parseMessagePayload } from './chat-message.util';

// Reporting/analytics over chat data, extracted from ChatService: dashboard
// activity, project message search, the AI journal, and the per-day metric
// rollups the stats plugin registers. Zero coupling to the agent loop or the
// LLM wire — it reads Prisma and resolves object refs, nothing more, so it is
// testable on its own.
@Injectable()
export class ChatAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  // Per-day assistant activity for the dashboard widget: how many messages
  // the user typed and how many agent tool calls actually executed. Tool
  // results are persisted as role:'user' rows whose content is a JSON payload
  // (`{"type":"tool_response",…}`), human messages are plain text — the
  // startsWith filters split the two without pulling message bodies. Rows are
  // scoped to the caller automatically (AIChatMessage is session-bound).
  async getActivity(
    days: number,
  ): Promise<{ date: string; messages: number; toolActions: number }[]> {
    const span = Math.min(Math.max(Math.trunc(days), 1), 90);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (span - 1));

    const [humanRows, toolRows] = await Promise.all([
      this.prisma.aIChatMessage.findMany({
        where: {
          createdAt: { gte: start },
          role: 'user',
          NOT: { content: { startsWith: '{"type":' } },
        },
        select: { createdAt: true },
      }),
      this.prisma.aIChatMessage.findMany({
        where: {
          createdAt: { gte: start },
          role: 'user',
          content: { startsWith: '{"type":"tool_response"' },
        },
        select: { createdAt: true },
      }),
    ]);

    const isoDay = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const tally = (rows: { createdAt: Date }[]): Map<string, number> => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const key = isoDay(row.createdAt);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      return map;
    };
    const messagesByDay = tally(humanRows);
    const toolsByDay = tally(toolRows);

    const out: { date: string; messages: number; toolActions: number }[] = [];
    for (let i = 0; i < span; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = isoDay(d);
      out.push({
        date: key,
        messages: messagesByDay.get(key) ?? 0,
        toolActions: toolsByDay.get(key) ?? 0,
      });
    }
    return out;
  }

  // 'yyyy-mm-dd' day key in local time — the shared day bucketer for the
  // project AI-history series (#59).
  private isoDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Inclusive lower bound `days` days back, at local midnight. `days` clamped [1,90].
  private activityStart(days: number): { start: Date; span: number } {
    const span = Math.min(Math.max(Math.trunc(days), 1), 90);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (span - 1));
    return { start, span };
  }

  // Per-project variant of getActivity (#59): messages typed + tool calls executed
  // per day, restricted to the project's sessions. Same human-vs-tool-response
  // content split; rows stay scoped to the caller (session-bound).
  async getProjectActivity(
    projectId: string,
    days: number,
  ): Promise<{ date: string; messages: number; toolActions: number }[]> {
    const { start, span } = this.activityStart(days);
    const [humanRows, toolRows] = await Promise.all([
      this.prisma.aIChatMessage.findMany({
        where: {
          createdAt: { gte: start },
          role: 'user',
          NOT: { content: { startsWith: MESSAGE_PREFIX.structured } },
          projectId,
        },
        select: { createdAt: true },
      }),
      this.prisma.aIChatMessage.findMany({
        where: {
          createdAt: { gte: start },
          role: 'user',
          content: { startsWith: MESSAGE_PREFIX.toolResponse },
          projectId,
        },
        select: { createdAt: true },
      }),
    ]);

    const tally = (rows: { createdAt: Date }[]): Map<string, number> => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const key = this.isoDay(row.createdAt);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
      return map;
    };
    const messagesByDay = tally(humanRows);
    const toolsByDay = tally(toolRows);

    const out: { date: string; messages: number; toolActions: number }[] = [];
    for (let i = 0; i < span; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = this.isoDay(d);
      out.push({
        date: key,
        messages: messagesByDay.get(key) ?? 0,
        toolActions: toolsByDay.get(key) ?? 0,
      });
    }
    return out;
  }

  // Full-text search across a project's chat messages (#59): case-insensitive
  // substring match over human + assistant text, excluding the JSON tool payloads
  // (same split as getActivity). Returns a page of hits with a server-built snippet
  // and the total match count. Rows are session-scoped to the caller.
  async searchProjectMessages(
    projectId: string,
    query: string,
    limit: number,
    offset: number,
  ): Promise<MessageSearchResult> {
    const q = query.trim();
    if (!q) return { hits: [], total: 0 };
    const take = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const skip = Math.max(Math.trunc(offset), 0);

    const where = {
      content: { contains: q, mode: 'insensitive' as const },
      NOT: { content: { startsWith: MESSAGE_PREFIX.structured } },
      projectId,
    };

    const [rows, total] = await Promise.all([
      this.prisma.aIChatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          sessionId: true,
          role: true,
          content: true,
          createdAt: true,
          session: {
            select: {
              title: true,
              messages: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      }),
      this.prisma.aIChatMessage.count({ where }),
    ]);

    return {
      total,
      hits: rows.map((r) => ({
        sessionId: r.sessionId,
        messageId: r.id,
        role: r.role,
        createdAt: r.createdAt,
        snippet: this.buildSnippet(r.content, q),
        sessionTitle: r.session.title ?? deriveSessionTitle(r.session.messages),
      })),
    };
  }

  // A short excerpt centered on the first case-insensitive match of `q`, with
  // ellipses when the source is truncated on either side.
  private buildSnippet(content: string, q: string): string {
    const RADIUS = 60;
    const idx = content.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) {
      return content.length > RADIUS * 2
        ? `${content.slice(0, RADIUS * 2)}…`
        : content;
    }
    const from = Math.max(0, idx - RADIUS);
    const to = Math.min(content.length, idx + q.length + RADIUS);
    const prefix = from > 0 ? '…' : '';
    const suffix = to < content.length ? '…' : '';
    return `${prefix}${content.slice(from, to)}${suffix}`;
  }

  // The AI action journal for a project (#59): what the assistant actually DID
  // there, reconstructed from persisted tool_call(+response)/pending/cancelled
  // messages. READ actions are omitted unless includeRead is set. Permission is
  // resolved from the live tool registry (removed tools → 'unknown'); affected
  // objects come from ORefs embedded in the call args and the response payload.
  async getProjectJournal(
    projectId: string,
    days: number,
    includeRead: boolean,
  ): Promise<ProjectJournal> {
    const { start } = this.activityStart(days);

    // Permission by tool name, from the live registry.
    const permByName = new Map<string, PermissionLevel>();
    for (const tool of this.agentRegistry.getTools()) {
      permByName.set(tool.name, tool.permission);
    }

    const rows = await this.prisma.aIChatMessage.findMany({
      where: {
        createdAt: { gte: start },
        projectId,
        OR: [
          { content: { startsWith: MESSAGE_PREFIX.toolCall } },
          { content: { startsWith: MESSAGE_PREFIX.toolCallPending } },
          { content: { startsWith: MESSAGE_PREFIX.toolCallCancelled } },
          { content: { startsWith: MESSAGE_PREFIX.toolResponse } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sessionId: true,
        content: true,
        createdAt: true,
        session: {
          select: { title: true, messages: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });

    // Canonical ORef strings embedded in a payload blob (formatObjectRef is the
    // sole ORef writer — §5.9).
    const refsIn = (value: unknown): string[] =>
      extractObjectRefs(JSON.stringify(value ?? null))
        .map((ref) => formatObjectRef(ref))
        .filter((s): s is string => s !== null);

    // First pass: index tool_response refs per (session, toolName) so an executed
    // call can absorb the objects its result referenced, not just its args.
    const responseRefs = new Map<string, string[]>();
    const key = (sessionId: string, name: string): string =>
      `${sessionId} ${name}`;
    for (const r of rows) {
      const data = parseMessagePayload(r.content);
      if (data?.type === 'tool_response' && data.name) {
        const refs = refsIn(data.response);
        if (refs.length) {
          const k = key(r.sessionId, data.name);
          responseRefs.set(k, [...(responseRefs.get(k) ?? []), ...refs]);
        }
      }
    }

    const statusByType: Record<string, JournalStatus> = {
      tool_call: 'executed',
      tool_call_pending: 'pending',
      tool_call_cancelled: 'cancelled',
    };

    const entries: JournalEntry[] = [];
    const affected = new Set<string>();
    const counts = { READ: 0, WRITE: 0, DESTRUCTIVE: 0, unknown: 0 };

    for (const r of rows) {
      const data = parseMessagePayload(r.content);
      if (!data?.type || data.type === 'tool_response') continue;
      const status = statusByType[data.type];
      if (!status) continue;
      const toolName = data.name ?? '';
      const permission = permByName.get(toolName) ?? 'unknown';
      if (permission === PermissionLevel.READ && !includeRead) continue;

      // Refs from the call args, plus (for executed calls) the response objects.
      const collected = new Set(refsIn(data.args));
      if (status === 'executed') {
        for (const ref of responseRefs.get(key(r.sessionId, toolName)) ?? []) {
          collected.add(ref);
        }
      }
      const refs = [...collected];

      counts[permission] += 1;
      for (const ref of refs) affected.add(ref);

      entries.push({
        messageId: r.id,
        sessionId: r.sessionId,
        sessionTitle: r.session.title ?? deriveSessionTitle(r.session.messages),
        createdAt: r.createdAt,
        toolName,
        permission,
        status,
        refs,
      });
    }

    // Newest first for display.
    entries.reverse();

    return {
      entries,
      summary: {
        byPermission: counts,
        affectedRefs: [...affected],
      },
    };
  }

  // Per-project LLM usage (#59): per-day request/token/error counts from
  // AIUsageEvent, read off the project each call was stamped with (#130). It
  // used to be a join through the session's project — the same anchor that made
  // a conversation belong to one project forever. Rows written before the
  // column existed, and calls made outside a turn (vision one-shots), carry
  // null and are naturally excluded.
  async getProjectUsage(
    projectId: string,
    days: number,
  ): Promise<ProjectUsage> {
    const { start, span } = this.activityStart(days);

    const emptyDays = (): ProjectUsage => {
      const dayList: ProjectUsage['days'] = [];
      for (let i = 0; i < span; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dayList.push({
          date: this.isoDay(d),
          requests: 0,
          tokens: 0,
          errors: 0,
        });
      }
      return { days: dayList, totals: { requests: 0, tokens: 0, errors: 0 } };
    };

    const rows = await this.prisma.aIUsageEvent.findMany({
      where: { createdAt: { gte: start }, projectId },
      select: {
        createdAt: true,
        totalTokens: true,
        isError: true,
      },
    });

    const result = emptyDays();
    const byDay = new Map(result.days.map((d) => [d.date, d]));
    for (const row of rows) {
      const bucket = byDay.get(this.isoDay(row.createdAt));
      if (!bucket) continue;
      bucket.requests += 1;
      bucket.tokens += row.totalTokens ?? 0;
      result.totals.requests += 1;
      result.totals.tokens += row.totalTokens ?? 0;
      if (row.isError) {
        bucket.errors += 1;
        result.totals.errors += 1;
      }
    }
    return result;
  }

  // Stats provider for the `chat.messages` metric (ticket #56): human messages
  // per day, grouped by owning scope. Called by the stats aggregation job inside
  // a systemBypass context, so it sees every user's messages at once and carries
  // each session's scopeId out on the point — the aggregate table then scopes
  // reads per user. Uses the same human-vs-tool-response content split as
  // getActivity (tool results are persisted as role:'user' JSON rows).
  async getMessageCountsByDayScope(
    from: Date,
    to: Date,
  ): Promise<StatsPoint[]> {
    const rows = await this.prisma.aIChatMessage.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        role: 'user',
        NOT: { content: { startsWith: '{"type":' } },
      },
      select: { createdAt: true, session: { select: { scopeId: true } } },
    });

    const isoDay = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const buckets = new Map<string, StatsPoint>();
    for (const row of rows) {
      const date = isoDay(row.createdAt);
      const scopeId = row.session?.scopeId ?? null;
      const key = `${date} ${scopeId ?? ''}`;
      const existing = buckets.get(key);
      if (existing) existing.value += 1;
      else buckets.set(key, { date, scopeId, value: 1 });
    }
    return [...buckets.values()];
  }

  // Stats provider source for the chat.usage.* metrics (ticket #55): per-day
  // LLM-call counts from AIUsageEvent, dimensioned by provider+model. `measure`
  // selects requests (all calls), tokens (sum of totalTokens) or errors (failed
  // calls). Called by the aggregation job under systemBypass, so each point
  // carries its owning scopeId.
  async getUsageCountsByDayScope(
    from: Date,
    to: Date,
    measure: 'requests' | 'tokens' | 'errors',
  ): Promise<StatsPoint[]> {
    const rows = await this.prisma.aIUsageEvent.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(measure === 'errors' ? { isError: true } : {}),
      },
      select: {
        createdAt: true,
        scopeId: true,
        provider: true,
        modelName: true,
        totalTokens: true,
      },
    });

    const isoDay = (d: Date): string => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const buckets = new Map<string, StatsPoint>();
    for (const row of rows) {
      const date = isoDay(row.createdAt);
      const scopeId = row.scopeId ?? null;
      const key = `${date} ${scopeId ?? ''} ${row.provider} ${row.modelName}`;
      const inc = measure === 'tokens' ? (row.totalTokens ?? 0) : 1;
      const existing = buckets.get(key);
      if (existing) existing.value += inc;
      else
        buckets.set(key, {
          date,
          scopeId,
          value: inc,
          dimensions: { provider: row.provider, model: row.modelName },
        });
    }
    return [...buckets.values()];
  }
}

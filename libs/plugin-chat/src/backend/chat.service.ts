import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AIChatMessage, AIChatSession, Prisma } from '@prisma/client';
import {
  PrismaService,
  AgentRegistryService,
  AttachmentStorageService,
  CapabilityRegistryService,
  PluginI18nService,
  RealtimeService,
  RequestContextService,
  getErrorMessage,
  generateUuid,
} from '@makekeeper/backend-core';

import {
  AgentStage,
  AgentTool,
  CHAT_REPLY_EVENT,
  CHAT_STAGE_EVENT,
  ChatReplyRealtimePayload,
  ChatStageRealtimePayload,
  PageContext,
  PermissionLevel,
  ResolvedChatContext,
  ConfirmationPolicy,
  defaultConfirmationPolicy,
  hasRecognitionProvenance,
  requiresConfirmation,
  ToolArgs,
  ToolConfirmSummary,
  attachmentTargetCapability,
  chatSessionRoom,
  checkAttachment,
  formatObjectRef,
  parseObjectRef,
  realtimeRoomId,
  attachmentRejectionParams,
  type AttachmentCandidate,
  type AttachmentPresence,
  type AttachmentTargetCapability,
} from '@makekeeper/plugin-contract';

import {
  AgentTurnError,
  HistoryMessage,
  LlmResult,
  LlmUsage,
  StoredMessagePayload,
  MESSAGE_PREFIX,
  PagedSessions,
  SessionListEntry,
  ProviderConfig,
  ProxyLabelContext,
  LlmProviderError,
} from './chat.types';
import { ProviderService } from './providers.service';
import { AttachmentSettingsService } from './attachment-settings.service';
import { LlmClient } from './llm-client';
import { deriveSessionTitle, parseMessagePayload } from './chat-message.util';
import { stampInZone } from './clock';

// A session as the client loads it: the messages plus a verdict for every
// attachment they reference. `AttachmentPresence` is the shared shape — the
// client's `SessionAttachment` is the same type, so the payload cannot drift.
type SessionWithMessages = AIChatSession & {
  messages: AIChatMessage[];
  attachments: AttachmentPresence[];
};

// Either the assistant reply that ended the turn, or a structured failure the
// client renders (reason + retry) — see AgentTurnError.
type AgentTurnResult = AIChatMessage | AgentTurnError;

// The object on screen that claims a file, together with the plugin that
// answered for it (#130). The owner travels with the ref so naming the
// destination and handing it the bytes are one lookup, not two.
type AttachmentTarget = {
  ref: string;
  name: string;
  pluginId: string;
  owner: AttachmentTargetCapability;
};

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly attachments: AttachmentStorageService,
    private readonly providerService: ProviderService,
    private readonly i18n: PluginI18nService,
    private readonly realtime: RealtimeService,
    private readonly llm: LlmClient,
    private readonly attachmentSettings: AttachmentSettingsService,
    private readonly requestContext: RequestContextService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  // The per-request half of a proxy label (#230): who is calling, and which
  // project the turn belongs to. The caller is the ACTUAL user, never the
  // connection's owner — the owner is already encoded in the label's own
  // segment, so repeating them would spend a segment saying nothing (#225).
  // Both are null on background and vision-only calls, where the composer
  // substitutes the placeholder.
  private async resolveProxyLabelContext(
    projectTitle: string | null,
  ): Promise<ProxyLabelContext> {
    const userId = this.requestContext.get()?.userId ?? null;
    if (!userId) return { user: null, project: projectTitle };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });
    return {
      user: user?.displayName || user?.username || null,
      project: projectTitle,
    };
  }

  // Live progress of an agent turn (#61), pushed into the session's room ahead
  // of the final CHAT_REPLY_EVENT, so the UI can show which step is running.
  private emitStage(sessionId: string, stage: AgentStage): void {
    const payload: ChatStageRealtimePayload = { sessionId, stage };
    this.realtime.emitToRoom(
      chatSessionRoom(sessionId),
      CHAT_STAGE_EVENT,
      payload,
    );
  }

  // Executes a tool with its progress stages (#61): tool_started → run →
  // tool_finished, plus a scoped data-changed nudge for a successful mutation.
  // Shared by the AUTO path in executeAgentLoop and the confirmed-tool path in
  // confirmTool so the emit sequence and the READ-skip rule live in one place.
  // What each session's current turn has called, for the log line the
  // iteration limit prints. Cleared when the run ends, so it never grows.
  private readonly turnToolTrace = new Map<string, string[]>();

  private async runToolWithStages(
    sessionId: string,
    turn: number,
    tool: AgentTool,
    args: ToolArgs,
  ): Promise<{ result: unknown; ok: boolean }> {
    this.emitStage(sessionId, {
      type: 'tool_started',
      turn,
      toolName: tool.name,
      permission: tool.permission,
    });
    const trace = this.turnToolTrace.get(sessionId) ?? [];
    trace.push(tool.name);
    this.turnToolTrace.set(sessionId, trace);
    let result: unknown;
    let ok = true;
    try {
      result = await tool.handler(args);
    } catch (err) {
      ok = false;
      result = { error: getErrorMessage(err) };
    }
    // Every call, not only the external ones. A turn that ends in the
    // iteration limit is a turn that called something five times, and without
    // this the log said only that the limit was reached.
    this.logger.log(
      `tool ${tool.name} (turn ${turn}) → ${ok ? 'ok' : 'error'}`,
    );
    this.emitStage(sessionId, {
      type: 'tool_finished',
      turn,
      toolName: tool.name,
      ok,
    });
    // Cross-device refetch nudge: a mutating tool just ran, so views of this
    // scope may be stale (the initiating client also keeps its local
    // notifyAgentDataChanged tick as the no-socket fallback).
    if (ok && tool.permission !== PermissionLevel.READ) {
      this.realtime.emitDataChanged([tool.pluginId]);
    }
    return { result, ok };
  }

  // Join check for `chat-session:<id>` rooms: sessions are user-private under
  // the multiuser overlay (scopeId = creating user), open in single-user mode.
  async authorizeRealtimeRoom(
    userId: string | null,
    room: string,
  ): Promise<boolean> {
    const sessionId = realtimeRoomId(room);
    if (!sessionId) return false;
    const session = await this.prisma.aIChatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return false;
    return session.scopeId === null || session.scopeId === userId;
  }

  onModuleInit(): void {
    // Build-freshness stamp (#15): if this line is missing from the serve log,
    // the running process is executing a STALE build — rebuild before debugging
    // any context issue. Bump the marker when the context pipeline changes.
    this.logger.log(
      'Chat context pipeline: v3 (server-side page-context resolver)',
    );
  }

  // The conversation the panel opens when the user has not picked one — the
  // oldest of the caller's own, created on first use. It is not "the project's
  // chat" any more (#130): a session belongs to the user, and the project rides
  // with each turn.
  async getOrCreateSession(): Promise<SessionWithMessages> {
    let session = await this.prisma.aIChatSession.findFirst({
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!session) {
      const id = 'session_' + Math.random().toString(36).substring(2, 9);
      session = await this.prisma.aIChatSession.create({
        data: { id },
        include: {
          messages: true,
        },
      });
    }

    return {
      ...session,
      attachments: await this.describeMessageAttachments(session.messages),
    };
  }

  // Every chat the caller has, newest first — one flat list since #130, because
  // there is nothing left to filter it by: a conversation crosses projects the
  // way the user does. Each row names the project of its latest turn instead.
  async listSessions(): Promise<SessionListEntry[]> {
    const sessions = await this.prisma.aIChatSession.findMany({
      // Pinned sessions float to the top; within each group, newest first.
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
    return this.summarizeSessions(sessions);
  }

  // Paginated project sessions for the AI-history panel (#59): the chats that
  // have at least one turn of this project. A chat that moved between projects
  // is listed under each of them — that is the truth about where its work
  // happened — and its message count reports THIS project's turns, so the
  // number agrees with the journal and the usage charts beside it (#130).
  async listSessionsPaged(
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<PagedSessions> {
    const take = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const skip = Math.max(Math.trunc(offset), 0);
    const where = { messages: { some: { projectId } } };
    const [rows, total] = await Promise.all([
      this.prisma.aIChatSession.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.aIChatSession.count({ where }),
    ]);
    return {
      total,
      items: await this.summarizeSessions(rows, projectId),
    };
  }

  // One session row as the lists state it. `countedProjectId` narrows the
  // message count to one project's turns (the project AI-history list); the
  // panel's own list passes nothing and counts the whole conversation — which
  // of the two a row carries is written down on `SessionListEntry.messageCount`.
  //
  // Three aggregates rather than the conversations themselves: a row needs a
  // count, a chip and — only for a session with no explicit name — a title. The
  // list used to load every message of every chat to compute those in JS, and
  // once #130 made the list flat that meant the user's whole history, tool
  // payloads and all, on every open of the panel.
  private async summarizeSessions(
    sessions: AIChatSession[],
    countedProjectId?: string,
  ): Promise<SessionListEntry[]> {
    const ids = sessions.map((session) => session.id);
    if (ids.length === 0) return [];
    const [counts, latestProjects, titles] = await Promise.all([
      this.countMessages(ids, countedProjectId),
      this.latestTurnProjects(ids),
      this.deriveTitles(sessions),
    ]);
    const names = await this.nameProjects([...latestProjects.values()]);
    return sessions.map((session) => {
      const projectId = latestProjects.get(session.id) ?? null;
      const name = projectId ? names.get(projectId) : undefined;
      return {
        id: session.id,
        createdAt: session.createdAt,
        // An explicit rename wins; otherwise fall back to the first-message title.
        title: session.title ?? titles.get(session.id) ?? null,
        pinned: session.pinned,
        messageCount: counts.get(session.id) ?? 0,
        // A project the caller cannot read is not named: the scoped client
        // simply did not return it, and the row shows no chip rather than an id.
        project: projectId && name ? { id: projectId, name } : null,
      };
    });
  }

  private async countMessages(
    sessionIds: readonly string[],
    countedProjectId?: string,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.aIChatMessage.groupBy({
      by: ['sessionId'],
      where: {
        sessionId: { in: [...sessionIds] },
        ...(countedProjectId ? { projectId: countedProjectId } : {}),
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.sessionId, row._count._all]));
  }

  // The project of each conversation's most recent stamped turn — what the chat
  // is currently about, as opposed to what it started as.
  //
  // Aggregate first, then read the rows it pointed at. `distinct` would have
  // said the same thing in one call, but Prisma applies it in the query engine
  // after the database has already handed over every matching row — which is
  // the cost this whole path exists to avoid.
  private async latestTurnProjects(
    sessionIds: readonly string[],
  ): Promise<Map<string, string>> {
    const where = await this.boundaryPerSession(
      { sessionId: { in: [...sessionIds] }, projectId: { not: null } },
      'newest',
    );
    if (!where) return new Map();
    const rows = await this.prisma.aIChatMessage.findMany({
      where,
      select: { sessionId: true, projectId: true },
    });
    const latest = new Map<string, string>();
    for (const row of rows) {
      if (row.projectId) latest.set(row.sessionId, row.projectId);
    }
    return latest;
  }

  // First-message titles, asked only for the sessions that have no explicit
  // name — a renamed chat never needs one.
  //
  // A session's opening turn is the user's own text, so the earliest user
  // message is the title in one round trip. "Human text" is a JS verdict
  // (the discriminant lives inside the content), so the rare session whose
  // first user row is an encoded payload gets a second, narrow pass rather
  // than a wrong answer.
  private async deriveTitles(
    sessions: readonly AIChatSession[],
  ): Promise<Map<string, string | null>> {
    const untitled = sessions
      .filter((session) => session.title === null)
      .map((session) => session.id);
    if (untitled.length === 0) return new Map();
    const where = await this.boundaryPerSession(
      { sessionId: { in: untitled }, role: 'user' },
      'oldest',
    );
    if (!where) return new Map();
    const firsts = await this.prisma.aIChatMessage.findMany({
      where,
      select: { sessionId: true, role: true, content: true },
    });
    const titles = new Map<string, string | null>();
    const unresolved: string[] = [];
    for (const row of firsts) {
      const title = deriveSessionTitle([row]);
      if (title === null) unresolved.push(row.sessionId);
      else titles.set(row.sessionId, title);
    }
    if (unresolved.length > 0) {
      const rest = await this.prisma.aIChatMessage.findMany({
        where: { sessionId: { in: unresolved }, role: 'user' },
        orderBy: { createdAt: 'asc' },
        select: { sessionId: true, role: true, content: true },
      });
      for (const sessionId of unresolved) {
        titles.set(
          sessionId,
          deriveSessionTitle(rest.filter((row) => row.sessionId === sessionId)),
        );
      }
    }
    return titles;
  }

  // A filter naming one message per session — the newest or the oldest of the
  // ones matching `where` — worked out by the database as an aggregate rather
  // than by fetching every candidate and picking in JS. Null when nothing
  // matches, so the caller can skip its own read. Each caller then selects the
  // columns IT needs, which is why this hands back a filter and not rows.
  //
  // A tie on `createdAt` within one session yields both rows; for messages
  // written by the same turn they say the same thing, and the callers'
  // last-write-wins mapping is indifferent to which arrives second.
  private async boundaryPerSession(
    where: Prisma.AIChatMessageWhereInput,
    edge: 'newest' | 'oldest',
  ): Promise<Prisma.AIChatMessageWhereInput | null> {
    // Both bounds are asked for whichever one is wanted: they are two columns
    // of one aggregate, and asking conditionally would only buy a union type
    // the caller then has to take apart.
    const bounds = await this.prisma.aIChatMessage.groupBy({
      by: ['sessionId'],
      where,
      _max: { createdAt: true },
      _min: { createdAt: true },
    });
    const picks = bounds.flatMap((bound) => {
      const createdAt =
        edge === 'newest' ? bound._max.createdAt : bound._min.createdAt;
      return createdAt ? [{ sessionId: bound.sessionId, createdAt }] : [];
    });
    return picks.length > 0 ? { AND: [where, { OR: picks }] } : null;
  }

  private async nameProjects(
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.project.findMany({
      where: { id: { in: unique } },
      select: { id: true, title: true },
    });
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  // Rename and/or pin a session (project AI-history list, #59). A null title
  // clears the override so the list falls back to the derived first-message title.
  async updateSession(
    sessionId: string,
    patch: { title?: string | null; pinned?: boolean },
  ): Promise<{ id: string; title: string | null; pinned: boolean }> {
    const data: { title?: string | null; pinned?: boolean } = {};
    if (patch.title !== undefined) data.title = patch.title?.trim() || null;
    if (patch.pinned !== undefined) data.pinned = patch.pinned;
    const updated = await this.prisma.aIChatSession.update({
      where: { id: sessionId },
      data,
    });
    return { id: updated.id, title: updated.title, pinned: updated.pinned };
  }

  async createSession(): Promise<
    AIChatSession & { messages: AIChatMessage[] }
  > {
    const id = 'session_' + Math.random().toString(36).substring(2, 9);
    return this.prisma.aIChatSession.create({
      data: { id },
      include: { messages: true },
    });
  }

  async getSession(sessionId: string): Promise<SessionWithMessages> {
    const session = await this.prisma.aIChatSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return {
      ...session,
      attachments: await this.describeMessageAttachments(session.messages),
    };
  }

  // Metadata for every attachment referenced by a session's messages (#112).
  //
  // A message stores only the URL, so without this the UI cannot tell a picture
  // from a file, and a non-image would render as an <img> that fetches the
  // WHOLE file just to fail decoding it. Sent with the history rather than
  // fetched per chip: one query here, no request storm and no flicker there.
  //
  // Total over the URLs the messages reference (#127): an attachment that no
  // longer exists comes back as `missing` rather than as no entry at all, which
  // the client could only read as "not loaded yet" — and so kept offering as a
  // download that saved the 404 body to disk.
  private async describeMessageAttachments(
    messages: AIChatMessage[],
  ): Promise<AttachmentPresence[]> {
    return this.attachments.findPresenceByUrls(
      messages.map((m) => m.imageData),
    );
  }

  // What this chat is currently working on (#129), as the panel states it.
  //
  // The context is not a file-filing detail — it is what the assistant answers
  // about: the project whose name goes into its prompt and onto its turns, the
  // object "this" and "here" resolve to, and where an upload is filed. The
  // composer used to state none of it, so a user had to infer it from the page
  // behind the panel.
  //
  // Three answers, all resolved here rather than in the browser so the line
  // cannot drift from the code that acts on it:
  //
  //   `project` — the scope in force for the next turn: the one the client
  //     carries, named here only if the caller may still read it. A project
  //     that has been deleted or has left the caller's scope comes back null,
  //     which is the signal the client drops its stale stickiness on (#130).
  //   `page` — the object the current screen has published as an ORef, named by
  //     the plugin that owns it (the same resolver the `resolve_object_ref`
  //     tool uses). This is the half that follows navigation across the whole
  //     app, not only across project pages.
  //   `filing` — who would take a file attached right now: the page's own owner
  //     when its plugin claims one, else that project.
  //
  // Everything is read through the scoped client / the owning plugin, so
  // anything the caller cannot see comes back null and the surface says so
  // instead of naming it.
  async resolveChatContext(
    refs: readonly string[],
    stickyProjectId: string | null,
  ): Promise<ResolvedChatContext> {
    const project = await this.resolveTurnProject(stickyProjectId);
    const target = await this.resolveAttachmentTarget(refs);
    return {
      project: project ? { id: project.id, name: project.title } : null,
      page: await this.resolvePageObject(refs),
      filing: target
        ? { name: target.name }
        : project
          ? { name: project.title }
          : null,
    };
  }

  // The project scope in force for a turn — the ONE place that rule lives, so
  // the line the panel states, the name the prompt carries and the stamp the
  // turn writes cannot disagree.
  //
  // Which project that is, is the client's answer, not this method's (#130):
  // the store walks the rule — a visited project page overrides, a hand-picked
  // one holds until the next visit — and sends the result with every request.
  // Re-deriving it here from the page refs used to override the picked scope,
  // so choosing "No project" on a project's own page was silently discarded and
  // the line re-rendered the project it had just been told to drop.
  //
  // What stays here is the half the browser may not decide: the id is read
  // through the scoped client before it is believed, so a project the caller
  // cannot see is not a scope — it falls through exactly as if it had never
  // been sent, and the caller is told the scope is gone.
  private async resolveTurnProject(
    scopeProjectId: string | null,
  ): Promise<{ id: string; title: string } | null> {
    if (!scopeProjectId) return null;
    return this.prisma.project.findUnique({
      where: { id: scopeProjectId },
      select: { id: true, title: true },
    });
  }

  // The object on screen that claims files of its own (#130) — an inventory
  // item and its photographs, say. Asked of the plugin named inside the ORef,
  // most-specific ref first, and a plugin that offers nothing simply is not an
  // owner: the caller then files into the project scope.
  // The owner comes back with the ref it answered for: the lookup that found it
  // is the lookup the adoption needs, and re-parsing the ref there to ask the
  // registry the same question twice is how the two could ever disagree about
  // who is taking the file.
  private async resolveAttachmentTarget(
    refs: readonly string[],
  ): Promise<AttachmentTarget | null> {
    for (const raw of refs) {
      const ref = parseObjectRef(raw);
      if (!ref) continue;
      const owner = this.capabilities.getCapability<AttachmentTargetCapability>(
        attachmentTargetCapability(ref.pluginId),
      );
      if (!owner) continue;
      const described = await owner.describeAttachmentTarget(raw);
      if (described) {
        return {
          ref: raw,
          name: described.name,
          pluginId: ref.pluginId,
          owner,
        };
      }
    }
    return null;
  }

  // The first page ORef that a plugin can still name. First, not all of them:
  // a view publishes its selection most-specific-first (the open cell before
  // its storage), and the line has room for one object plus its breadcrumb.
  private async resolvePageObject(
    refs: readonly string[],
  ): Promise<{ name: string; breadcrumb: string | null } | null> {
    for (const ref of refs) {
      const resolved = await this.agentRegistry.resolveObjectRef(ref);
      if (resolved?.exists) {
        return {
          name: resolved.displayName,
          breadcrumb: resolved.breadcrumb ?? null,
        };
      }
    }
    return null;
  }

  async deleteSession(sessionId: string): Promise<{ id: string }> {
    // Files on disk have no FK cascade — remove them (and their rows) first.
    await this.attachments.deleteBySession(sessionId);
    // Messages cascade-delete via the AIChatMessage → AIChatSession relation.
    await this.prisma.aIChatSession.delete({ where: { id: sessionId } });
    return { id: sessionId };
  }

  // A short label for the session list, taken from the first human message.

  // Human-typed messages are plain text; tool call/response messages are JSON
  // payloads carrying a `type` field.

  // Server-side half of the attachment gate (#112). Throws the first rejection
  // as an i18n message the client renders verbatim — the same wording the
  // composer already showed, so a user who somehow gets past the UI tier reads
  // one explanation, not two.
  //
  // A candidate is described WITHOUT opening its file: a stored attachment from
  // its row, a data URL from its header and base64 length. Neither path reads
  // the payload to judge it.
  private async assertAttachmentsAllowed(
    attachments: string[],
    locale?: string,
  ): Promise<void> {
    if (attachments.length === 0) return;
    const rules = await this.attachmentSettings.resolveEffective();
    const stored = await this.attachments.findMetaByUrls(
      attachments.filter((value) => !value.startsWith('data:')),
    );

    for (const attachment of attachments) {
      const candidate = attachment.startsWith('data:')
        ? describeDataUrl(attachment)
        : stored.get(attachment);
      // Unknown reference: not ours to judge here. It resolves to nothing when
      // claimed, and an invalid data URL is dropped by the storage layer.
      if (!candidate) continue;

      const rejection = checkAttachment(candidate, rules);
      if (!rejection) continue;

      const filename =
        rejection.filename ||
        this.i18n.t('chat.attachments.unnamedFile', undefined, locale);
      throw new Error(
        this.i18n.t(
          rejection.reason === 'format'
            ? 'chat.attachments.rejected.format'
            : 'chat.attachments.rejected.size',
          attachmentRejectionParams(rejection, filename),
          locale,
        ),
      );
    }
  }

  async sendMessage(
    sessionId: string,
    userContent: string,
    images?: string[],
    pageContext?: PageContext,
    locale?: string,
    stickyProjectId?: string | null,
  ): Promise<AgentTurnResult> {
    const session = await this.prisma.aIChatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session)
      throw new Error(
        this.i18n.t('chat.errors.sessionNotFound', undefined, locale),
      );

    // 0. Gate the attachments (#112) BEFORE anything is persisted, so a refused
    // file leaves no half-written turn behind. The composer runs the same rules
    // for instant feedback, but this tier is the one that decides: the ruleset
    // belongs to the owner of the ACTIVE connection, which can change between
    // attaching a file and pressing send.
    await this.assertAttachmentsAllowed(images ?? [], locale);

    // The scope this whole turn runs in (#130): the one the client sends, kept
    // only if the caller may read it. Every message the turn writes is stamped
    // with it, the prompt names it, and — unless the page has an owner of its
    // own — the files land in it.
    const project = await this.resolveTurnProject(stickyProjectId ?? null);
    const turnProjectId = project?.id ?? null;

    // 1. Persist each attached image to disk; messages keep only the URLs. A
    // data URL (typed/pasted) is saved now; an already-stored "/api/uploads/:id"
    // URL — e.g. photos shot on a paired phone (issue #6) — is claimed into this
    // chat so the capture GC won't reclaim its file.
    //
    // Where the bytes belong is the page's answer first: a picture taken while
    // an inventory item is open is that item's, not the surrounding project's
    // (#130). Only when nothing on screen claims it does it fall to the turn's
    // project. Resolved by the same helper the context line reads, so the bytes
    // land where the panel said they would.
    const target = await this.resolveAttachmentTarget(pageContext?.refs ?? []);
    const attachmentProjectId = target ? null : turnProjectId;
    const imageUrls: string[] = [];
    for (const image of images ?? []) {
      if (image.startsWith('data:')) {
        const url = await this.attachments.saveDataUrl(
          { pluginId: 'chat', projectId: attachmentProjectId, sessionId },
          image,
        );
        if (url) imageUrls.push(url);
      } else {
        await this.attachments.claim(image, {
          pluginId: 'chat',
          projectId: attachmentProjectId,
          sessionId,
        });
        imageUrls.push(image);
      }
    }
    // The owning plugin writes the link to its own record — the chat only ever
    // saved the bytes (§5.10). An owner that refuses (the object went away, the
    // picture is not adoptable) must not cost the user their message: the file
    // stays with the conversation, which is where it already is.
    if (target && imageUrls.length > 0) {
      await this.adoptAttachments(target, imageUrls);
    }

    // 2. Save one user message per image (image-only), then the text message.
    // Each message carries a single imageData (the storage/vision/provider layers
    // stay single-image), but the turn's vision inliner aggregates every user
    // image in history — so all photos reach the model in one turn.
    const newId = (): string =>
      'msg_' + Math.random().toString(36).substring(2, 9);
    for (const url of imageUrls) {
      await this.prisma.aIChatMessage.create({
        data: {
          id: newId(),
          sessionId,
          projectId: turnProjectId,
          role: 'user',
          content: '',
          imageData: url,
        },
      });
    }
    if (userContent.trim() || imageUrls.length === 0) {
      await this.prisma.aIChatMessage.create({
        data: {
          id: newId(),
          sessionId,
          projectId: turnProjectId,
          role: 'user',
          content: userContent,
          imageData: null,
        },
      });
    }

    // 3. Load complete history & run execution loop. The page context rides along
    // this turn only (it is a per-message layer, not persisted history), so tool
    // loops within this turn stay aware of where the user asked from.
    return this.runAgentTurn(
      sessionId,
      turnProjectId,
      pageContext,
      undefined,
      locale,
    );
  }

  // Hand already-stored uploads to the plugin that owns the object on screen.
  // Best-effort by design: the bytes are saved and the message is about to be
  // written, so an owner that cannot take them (item deleted mid-turn, picture
  // already owned elsewhere) leaves the file with the conversation rather than
  // failing the turn the user asked for.
  private async adoptAttachments(
    target: AttachmentTarget,
    urls: readonly string[],
  ): Promise<void> {
    try {
      await target.owner.adoptAttachments(target.ref, urls);
    } catch (err) {
      this.logger.warn(
        `attachment adoption refused by ${target.pluginId} for ${target.ref}: ${getErrorMessage(err)}`,
      );
    }
  }

  // The scope a continuation turn runs in: the one its own turn was stamped
  // with. Confirming a tool call, cancelling it or retrying after a failure
  // continues a turn that already happened — reading the client's current
  // stickiness instead would let a navigation between the card and the click
  // re-scope work the user already saw described (#130).
  //
  // The LAST message, whatever it is stamped with — including nothing. Skipping
  // over the unstamped ones would answer with an older turn's project, so a
  // deliberately project-less turn would come back scoped the moment its tool
  // call was confirmed: into the prompt, onto the continuation's messages and
  // onto its usage rows. Every write in this service stamps the turn's scope,
  // so a null here is a real "no project", not a gap.
  private async lastTurnProjectId(sessionId: string): Promise<string | null> {
    const last = await this.prisma.aIChatMessage.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      select: { projectId: true },
    });
    return last?.projectId ?? null;
  }

  async confirmTool(
    sessionId: string,
    messageId: string,
    toolName: string,
    args: ToolArgs,
    locale?: string,
  ): Promise<AgentTurnResult> {
    const tool = this.agentRegistry.getEnabledTool(toolName);
    if (!tool)
      throw new Error(
        this.i18n.t('chat.errors.toolNotFound', { name: toolName }, locale),
      );

    // Read the pending record first: it carries the loop iteration the call was
    // proposed in, so the execution stages report the real turn number instead
    // of a fabricated one, plus the Gemini thought signature to replay later.
    const pendingMsg = await this.prisma.aIChatMessage.findUnique({
      where: { id: messageId },
    });
    const pendingData: StoredMessagePayload | null = pendingMsg
      ? parseMessagePayload(pendingMsg.content)
      : null;
    const turn = pendingData?.turn ?? 1;

    // The turn being continued keeps the scope it was started in.
    const turnProjectId = await this.lastTurnProjectId(sessionId);

    // 1. Execute tool (shared stage/nudge sequence with the AUTO path).
    const { result } = await this.runToolWithStages(
      sessionId,
      turn,
      tool,
      args,
    );

    if (pendingMsg) {
      await this.prisma.aIChatMessage.update({
        where: { id: messageId },
        data: {
          content: JSON.stringify({
            type: 'tool_call',
            name: toolName,
            args,
            thoughtSignature: pendingData?.thoughtSignature,
          }),
        },
      });
    }

    const responseId = 'msg_' + Math.random().toString(36).substring(2, 9);
    await this.prisma.aIChatMessage.create({
      data: {
        id: responseId,
        sessionId,
        projectId: turnProjectId,
        role: 'user',
        content: JSON.stringify({
          type: 'tool_response',
          name: toolName,
          response: result,
        }),
      },
    });

    return this.runAgentTurn(
      sessionId,
      turnProjectId,
      undefined,
      undefined,
      locale,
    );
  }

  async cancelTool(
    sessionId: string,
    messageId: string,
    locale?: string,
  ): Promise<AgentTurnResult> {
    const pendingMsg = await this.prisma.aIChatMessage.findUnique({
      where: { id: messageId },
    });
    if (!pendingMsg)
      throw new Error(
        this.i18n.t('chat.errors.requestNotFound', undefined, locale),
      );

    const pendingData: StoredMessagePayload = JSON.parse(pendingMsg.content);

    await this.prisma.aIChatMessage.update({
      where: { id: messageId },
      data: {
        content: JSON.stringify({
          type: 'tool_call_cancelled',
          name: pendingData.name,
          args: pendingData.args,
        }),
      },
    });

    const turnProjectId = await this.lastTurnProjectId(sessionId);

    const userMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
    await this.prisma.aIChatMessage.create({
      data: {
        id: userMsgId,
        sessionId,
        projectId: turnProjectId,
        role: 'user',
        content: this.i18n.t(
          'chat.messages.actionCancelledByUser',
          { name: pendingData.name ?? '' },
          locale,
        ),
      },
    });

    // Withdraw the just-rejected tool from the continuation turn so the model
    // can't immediately re-propose it — otherwise the standing user request
    // ("delete X") makes it re-issue the same call and the confirmation card
    // loops forever. A fresh user message re-enables the tool.
    return this.runAgentTurn(
      sessionId,
      turnProjectId,
      undefined,
      pendingData.name,
      locale,
    );
  }

  // Re-runs the last agent turn for a session after a transient LLM failure, using
  // the already-persisted history (no new user message). Safe to call repeatedly:
  // it only re-issues LLM requests and never re-executes an already-completed tool.
  async retryTurn(
    sessionId: string,
    locale?: string,
  ): Promise<AgentTurnResult> {
    const session = await this.prisma.aIChatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session)
      throw new Error(
        this.i18n.t('chat.errors.sessionNotFound', undefined, locale),
      );
    return this.runAgentTurn(
      sessionId,
      await this.lastTurnProjectId(sessionId),
      undefined,
      undefined,
      locale,
    );
  }

  // Runs the agent loop and converts an upstream LLM failure into a structured
  // result the client can render (reason + retry) instead of a 500. Any other error
  // is logged and returned as a generic reason.
  private async runAgentTurn(
    sessionId: string,
    projectId: string | null,
    pageContext?: PageContext,
    declinedToolName?: string,
    locale?: string,
  ): Promise<AgentTurnResult> {
    let result: AgentTurnResult;
    try {
      result = await this.executeAgentLoop(
        sessionId,
        projectId,
        1,
        pageContext,
        declinedToolName,
        locale,
      );
    } catch (err) {
      if (err instanceof LlmProviderError) {
        result = {
          error: true,
          message: err.message,
          provider: err.provider,
          status: err.status,
        };
      } else {
        this.logger.error(`Agent turn failed: ${getErrorMessage(err)}`);
        result = { error: true, message: getErrorMessage(err) };
      }
    } finally {
      this.emitStage(sessionId, { type: 'turn_finished' });
    }
    // Deliver the final result over the socket (#61) — the sole delivery of the
    // turn outcome to the client (the command ack only reports acceptance). A
    // long turn (real LLM + multi-step tools) never blocks an HTTP request now;
    // the client renders whatever this event carries (assistant message or a
    // structured turn error).
    const payload: ChatReplyRealtimePayload = { sessionId, result };
    this.realtime.emitToRoom(
      chatSessionRoom(sessionId),
      CHAT_REPLY_EVENT,
      payload,
    );
    return result;
  }

  // Provider error bodies are usually JSON like { error: { message } }. Pull out the
  // human-readable message for the UI, falling back to the raw text when it isn't.

  private async executeAgentLoop(
    sessionId: string,
    projectId: string | null,
    turn = 1,
    pageContext?: PageContext,
    declinedToolName?: string,
    locale?: string,
  ): Promise<AIChatMessage> {
    if (turn > 5) {
      // Name the tools it kept reaching for: a loop is almost always a model
      // hunting for a capability it does not have, and the list is the fastest
      // way to see which one.
      this.logger.warn(
        `tool iteration limit reached after ${turn - 1} turns; tools called: ${
          [...(this.turnToolTrace.get(sessionId) ?? [])].join(', ') || '(none)'
        }`,
      );
      this.turnToolTrace.delete(sessionId);
      return this.prisma.aIChatMessage.create({
        data: {
          id: 'msg_' + Math.random().toString(36).substring(2, 9),
          sessionId,
          projectId,
          role: 'assistant',
          content: this.i18n.t(
            'chat.messages.iterationLimit',
            undefined,
            locale,
          ),
        },
      });
    }

    // A fresh run starts a fresh trace: the map is per RUN, not per session,
    // or a long conversation would accumulate every tool it ever called.
    if (turn === 1) this.turnToolTrace.delete(sessionId);

    // Announce the loop iteration before any provider/tool work, so the UI's
    // stage line shows the step number the moment the turn starts.
    this.emitStage(sessionId, { type: 'turn_started', turn });

    // 1. Fetch Provider — resolved per request: personal connection →
    // workspace owner's shared one → instance default (see ProviderService).
    // The apiKey is decrypted here (#63); a `locked` result means the resolved
    // connection is personal and its owner's DEK is not armed (offline owner /
    // signed-out guest) — surface a re-auth notice rather than a raw failure.
    const resolvedProvider = await this.providerService.resolveActiveRuntime();

    if (resolvedProvider.status === 'none') {
      const allMessages = await this.prisma.aIChatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });
      const lastUserMsg = allMessages.filter((m) => m.role === 'user').pop();
      const content = this.i18n.t(
        'chat.messages.simulationMode',
        { question: lastUserMsg?.content ?? '' },
        locale,
      );
      return this.prisma.aIChatMessage.create({
        data: {
          id: 'msg_' + Math.random().toString(36).substring(2, 9),
          sessionId,
          projectId,
          role: 'assistant',
          content,
        },
      });
    }

    if (resolvedProvider.status === 'locked') {
      return this.prisma.aIChatMessage.create({
        data: {
          id: 'msg_' + Math.random().toString(36).substring(2, 9),
          sessionId,
          projectId,
          role: 'assistant',
          content: this.i18n.t(
            'chat.messages.providerLocked',
            undefined,
            locale,
          ),
        },
      });
    }

    const activeProvider = resolvedProvider.config;
    // Audit + notify the owner when their personal key is used out of session
    // (a guest via a shared connection, or an unattended background job) (#63).
    await this.providerService.recordRuntimeUse(resolvedProvider.ownerUserId);

    const toolConfigs = await this.prisma.agentToolConfig.findMany({
      where: { isEnabled: true },
    });
    const enabledNames = new Set(toolConfigs.map((c) => c.toolName));
    const allTools = this.agentRegistry.getEnabledTools();
    // A refusal ends the turn's DOING. Withholding only the rejected tool left
    // the model holding every other one and a note saying its plan was refused
    // — and it reached for the next tool it could see: a person who declined a
    // reminder was offered an empty purchase order (#326). "No" is not an
    // invitation to try something else, so the continuation turn has no tools
    // at all and can only answer in words. Whatever should happen next, the
    // person will say so, and the turn after that has its tools back.
    const activeTools = declinedToolName
      ? []
      : allTools.filter((t) => enabledNames.has(t.name));

    // A registered tool with no config row is silently invisible to the model,
    // which is indistinguishable from "the plugin does not work" (#164). Say it
    // out loud: this filter was the whole defect and left no trace anywhere.
    const unconfigured = allTools
      .filter((t) => !enabledNames.has(t.name))
      .map((t) => t.name);
    if (unconfigured.length > 0) {
      this.logger.warn(
        `tools registered but not offered (no enabled config row): ${unconfigured.join(', ')}`,
      );
    }

    const allMessages = await this.prisma.aIChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    // 4. Name the project scope — no more than that (#130).
    //
    // The prompt used to inline the whole project: description, status, every
    // task, every linked part with its needed/reserved/available figures. That
    // was affordable while a conversation lived inside one project and cost one
    // build per turn there. The scope now follows the user across every screen,
    // so the same block would ride along on the dashboard, in the inventory, in
    // the settings — a project's worth of tokens per turn, most of it noise for
    // the question actually being asked. The agent has tools for all of it and
    // the ORef below to aim them with; what it cannot recover on its own is
    // WHICH project it is working in, and that is what stays.
    //
    // The project's own two-line identity — its description and its status —
    // stays with the name. It is what the title means, it is a fixed couple of
    // lines rather than a block that grows with the project, and dropping it
    // would make the agent spend a tool call to learn what the scope it was
    // just handed actually is.
    const project = !projectId
      ? null
      : await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, title: true, description: true, status: true },
        });

    // 5. System Prompt — every fragment resolved to the caller's locale (the
    // per-user locale threaded from the request) so the whole prompt is in the
    // language the user is chatting in.
    let systemPrompt =
      this.i18n.t('chat.prompt.systemIntro', undefined, locale) + '\n';
    // A model with no clock cannot answer "in two minutes", and one with no
    // location cannot name a zone: left to guess, it wrote a repeat rule with
    // no start at all and called the zone UTC (#318/#319). Both facts are the
    // caller's, and both are stated once, here.
    const zone = this.requestContext.get()?.timezone ?? 'UTC';
    const now = stampInZone(new Date(), zone);
    systemPrompt +=
      this.i18n.t(
        'chat.prompt.now',
        { now: now.readable, zone, stamp: now.stamp },
        locale,
      ) + '\n';
    // The ORef is what makes the name actionable: with the project's contents
    // no longer inlined, this is the handle the agent passes to the tools that
    // fetch them.
    const projectRef = project
      ? formatObjectRef({
          pluginId: 'projects',
          entityType: 'project',
          entityId: project.id,
        })
      : null;
    if (project && projectRef) {
      systemPrompt +=
        this.i18n.t(
          'chat.prompt.projectScope',
          { title: project.title, ref: projectRef },
          locale,
        ) + '\n';
      if (project.description) {
        systemPrompt +=
          this.i18n.t(
            'chat.prompt.projectDescription',
            { description: project.description },
            locale,
          ) + '\n';
      }
      systemPrompt +=
        this.i18n.t(
          'chat.prompt.projectStatus',
          { status: project.status },
          locale,
        ) + '\n';
    }
    systemPrompt += '\n';

    systemPrompt += await this.buildPageContextPrompt(pageContext, locale);

    systemPrompt +=
      '\n' + this.i18n.t('chat.prompt.closingInstructions', undefined, locale);

    // Document the ORef scheme once (#16): how to read the "mk://…" references the
    // page context and tool outputs carry, and that echoing them makes replies link.
    systemPrompt +=
      '\n' + this.i18n.t('chat.prompt.objectRefs', undefined, locale);

    // Anti-hallucination guardrail for photo-based component recognition (#13).
    // Conditional on an image being present, so ordinary chat is unaffected; it
    // asks for verbatim markings + a structured presentation instead of forcing
    // a JSON schema (which would break tool-calling / free-form replies).
    systemPrompt +=
      '\n\n' + this.i18n.t('chat.prompt.photoRecognition', undefined, locale);

    this.emitStage(sessionId, { type: 'llm_call_started', turn });
    let llmResult: LlmResult;
    try {
      llmResult = await this.llm.complete(
        activeProvider,
        systemPrompt,
        allMessages,
        activeTools,
        locale,
        (usage) =>
          this.recordUsage(activeProvider, usage, false, sessionId, projectId),
        await this.resolveProxyLabelContext(project?.title ?? null),
      );
    } catch (err) {
      // A failed call produces no assistant message; still record it for usage
      // error attribution (#55), then let the existing error handling proceed.
      if (err instanceof LlmProviderError) {
        await this.recordUsage(
          activeProvider,
          null,
          true,
          sessionId,
          projectId,
        );
      }
      throw err;
    }
    this.emitStage(sessionId, { type: 'llm_call_finished', turn });

    if (typeof llmResult === 'string') {
      const assistantMsgId =
        'msg_' + Math.random().toString(36).substring(2, 9);
      return this.prisma.aIChatMessage.create({
        data: {
          id: assistantMsgId,
          sessionId,
          projectId,
          role: 'assistant',
          content: llmResult,
        },
      });
    } else {
      const { name, args, thoughtSignature } = llmResult;

      const config = toolConfigs.find((c) => c.toolName === name);
      const tool = activeTools.find((t) => t.name === name);

      if (!tool) {
        const responseId = 'msg_' + Math.random().toString(36).substring(2, 9);
        await this.prisma.aIChatMessage.create({
          data: {
            id: responseId,
            sessionId,
            projectId,
            role: 'user',
            content: JSON.stringify({
              type: 'tool_response',
              name,
              response: {
                error: this.i18n.t(
                  'chat.messages.toolNotRegistered',
                  { name },
                  locale,
                ),
              },
            }),
          },
        });
        return this.executeAgentLoop(
          sessionId,
          projectId,
          turn + 1,
          pageContext,
          declinedToolName,
          locale,
        );
      }

      // Stored per-tool config wins; the fallback (row not yet seeded) uses the
      // one shared default so a WRITE tool gates just like the seed path does.
      // The DB column is a free string, so narrow it to the policy union — any
      // unexpected value falls back to the tool's seed default.
      const policy: ConfirmationPolicy =
        config?.confirmationPolicy === 'AUTO' ||
        config?.confirmationPolicy === 'CONFIRM'
          ? config.confirmationPolicy
          : defaultConfirmationPolicy(tool.permission);

      // Provenance gate (#72): a mutation whose data came from recognition — the
      // tool carries the image itself (recognitionOrigin), or the current run is
      // acting on a user photo — confirms regardless of an AUTO relaxation, so a
      // vision misread can't write silently. Manual, image-free edits keep their
      // stored policy. `recognized` (a mutation with recognition provenance)
      // also drives the "verify the numbers" hint on the card.
      const visionTurn = this.runHasVisionInput(allMessages);
      const recognized = hasRecognitionProvenance({
        permission: tool.permission,
        recognitionOrigin: tool.recognitionOrigin,
        visionTurn,
      });

      if (
        requiresConfirmation({
          policy,
          permission: tool.permission,
          recognitionOrigin: tool.recognitionOrigin,
          visionTurn,
        })
      ) {
        const msgId = 'msg_' + Math.random().toString(36).substring(2, 9);
        this.emitStage(sessionId, {
          type: 'awaiting_confirmation',
          turn,
          toolName: name,
        });
        // Resolve a human-readable summary (ids → names) for the confirmation
        // card. Best-effort: a resolver failure must never block the prompt.
        const summary = await this.buildConfirmSummary(tool, args);
        return this.prisma.aIChatMessage.create({
          data: {
            id: msgId,
            sessionId,
            projectId,
            role: 'assistant',
            content: JSON.stringify({
              type: 'tool_call_pending',
              name,
              args,
              thoughtSignature,
              summary,
              recognized,
              // Persist the iteration so confirmTool's execution stages report
              // the real turn number once the user confirms.
              turn,
            }),
          },
        });
      } else {
        const toolMsgId = 'msg_' + Math.random().toString(36).substring(2, 9);
        await this.prisma.aIChatMessage.create({
          data: {
            id: toolMsgId,
            sessionId,
            projectId,
            role: 'assistant',
            content: JSON.stringify({
              type: 'tool_call',
              name,
              args,
              thoughtSignature,
            }),
          },
        });

        const { result } = await this.runToolWithStages(
          sessionId,
          turn,
          tool,
          args,
        );

        const responseId = 'msg_' + Math.random().toString(36).substring(2, 9);
        await this.prisma.aIChatMessage.create({
          data: {
            id: responseId,
            sessionId,
            projectId,
            role: 'user',
            content: JSON.stringify({
              type: 'tool_response',
              name,
              response: result,
            }),
          },
        });

        return this.executeAgentLoop(
          sessionId,
          projectId,
          turn + 1,
          pageContext,
          declinedToolName,
          locale,
        );
      }
    }
  }

  // Renders the current-page context (issue #3) as a system-prompt block so the
  // agent can resolve deictic references ("this project", "here") against the
  // screen the user asked from. Returns '' when no usable context was supplied.
  // Matches the surrounding Russian system-prompt style; the explicit note keeps
  // context from being read as authority to skip a DESTRUCTIVE confirmation.
  private async buildPageContextPrompt(
    pageContext?: PageContext,
    locale?: string,
  ): Promise<string> {
    if (!pageContext) return '';

    const lines: string[] = [];
    // Authoritative channel first: the owning plugin resolves the route ids
    // (storageId/row/col, …) into an exact description SERVER-SIDE, from the DB.
    // A stale client bundle cannot corrupt this — it only ever sends ids.
    const resolved = await this.agentRegistry.resolvePageContext(pageContext);
    // Ground-truth trace (#15): what context this turn actually carries. Shown in
    // the serve log so a context bug is diagnosable from the terminal, without
    // spending LLM calls or guessing what the browser sent.
    this.logger.log(
      `PageContext: query=${JSON.stringify(pageContext.query ?? {})} → resolved=${
        resolved ? `"${resolved}"` : 'null'
      }${resolved ? '' : pageContext.summary ? ' (client summary fallback)' : ' (raw fallback)'}`,
    );
    if (resolved) {
      lines.push(
        this.i18n.t(
          'chat.prompt.pageContextSelection',
          { value: resolved },
          locale,
        ),
      );
    } else if (pageContext.summary) {
      // Fallback: the client-composed summary, when no server resolver exists.
      lines.push(
        this.i18n.t(
          'chat.prompt.pageContextSelection',
          { value: pageContext.summary },
          locale,
        ),
      );
    }
    // Machine-parseable selection (#16): canonical ORef(s) the agent can pass back
    // into tools verbatim, instead of re-extracting ids from the prose selection.
    if (pageContext.refs?.length)
      lines.push(
        this.i18n.t(
          'chat.prompt.pageContextRefs',
          { refs: pageContext.refs.join(', ') },
          locale,
        ),
      );
    if (pageContext.routeName)
      lines.push(
        this.i18n.t(
          'chat.prompt.pageContextRoute',
          { route: pageContext.routeName },
          locale,
        ),
      );
    if (pageContext.path)
      lines.push(
        this.i18n.t(
          'chat.prompt.pageContextPath',
          { path: pageContext.path },
          locale,
        ),
      );
    if (pageContext.pluginId)
      lines.push(
        this.i18n.t(
          'chat.prompt.pageContextPlugin',
          { plugin: pageContext.pluginId },
          locale,
        ),
      );

    // Raw params/query are only useful when nothing resolved them into a precise
    // description; once resolved, they are pure noise the LLM may misread (e.g.
    // re-deriving cell addresses from row/col with the wrong convention).
    if (!resolved) {
      const params = this.formatContextRecord(pageContext.params);
      if (params)
        lines.push(
          this.i18n.t('chat.prompt.pageContextParams', { params }, locale),
        );
      const query = this.formatContextRecord(pageContext.query);
      if (query)
        lines.push(
          this.i18n.t('chat.prompt.pageContextQuery', { query }, locale),
        );
    }

    if (lines.length === 0) return '';

    return (
      '\n' +
      this.i18n.t('chat.prompt.pageContextHeader', undefined, locale) +
      '\n' +
      this.i18n.t('chat.prompt.pageContextIntro', undefined, locale) +
      '\n' +
      `${lines.join('\n')}\n`
    );
  }

  // Flattens a route params/query bag into "key=value, key=value" for the prompt,
  // skipping empty values. Returns '' for an empty/absent map.
  private formatContextRecord(record?: Record<string, string>): string {
    if (!record) return '';
    return Object.entries(record)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
  }

  // True when the current agent run's input originates from a photo (#72): scan
  // back to the start of this run — the messages after the last completed
  // (plain-text) assistant reply — and report whether a user image sits inside
  // that window. A mutation proposed while recognising a photo must confirm even
  // if its tool is relaxed to AUTO, so a vision misread ("7 → 70") is caught;
  // a "+5" typed in a later, image-free turn stays frictionless. Structured
  // assistant messages (tool_call/pending) belong to the current run, so only a
  // real text reply closes the window.
  private runHasVisionInput(messages: AIChatMessage[]): boolean {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (
        message.role === 'assistant' &&
        !message.content.startsWith(MESSAGE_PREFIX.structured)
      ) {
        break;
      }
      if (message.role === 'user' && message.imageData) return true;
    }
    return false;
  }

  // Resolves the tool's own confirmation summary (ids → human names) for the
  // pending card. Best-effort: any resolver failure is logged and dropped so the
  // confirmation prompt still appears (the card falls back to name + args).
  private async buildConfirmSummary(
    tool: AgentTool,
    args: ToolArgs,
  ): Promise<ToolConfirmSummary | undefined> {
    if (!tool.confirmSummary) return undefined;
    try {
      return await tool.confirmSummary(args);
    } catch (err) {
      this.logger.warn(
        `confirmSummary failed for "${tool.name}": ${getErrorMessage(err)}`,
      );
      return undefined;
    }
  }

  // A call the agent proposed but that is still awaiting the user's confirmation
  // (tool_call_pending): it has NOT executed and has no tool_response. Replaying
  // it as an executed function call would leave a dangling call with no matching
  // response and corrupt the next turn (Gemini/OpenAI reject the unpaired call),
  // so it rides along as a plain assistant note instead. Model-facing text —
  // matches the Russian system-prompt style, not a user-facing UI string.

  // Public, session-less one-shot vision completion for other plugins (e.g. the
  // logistics screenshot-import). Resolves the active provider like a normal
  // chat turn, sends a single user message with an image + instruction under
  // `systemPrompt`, runs no tools, and returns the raw text reply. Returns null
  // when no provider is configured. `imageUrl` is a "/api/uploads/:id" URL.
  async runVisionCompletion(
    systemPrompt: string,
    userText: string,
    imageUrls: string[],
    locale?: string,
  ): Promise<string | null> {
    const resolved = await this.providerService.resolveActiveRuntime();
    // No provider, or a personal connection whose owner's DEK is not armed
    // (#63): the caller (e.g. logistics import) gets null and degrades, exactly
    // as when nothing is configured.
    if (resolved.status !== 'ready') return null;
    const activeProvider = resolved.config;
    await this.providerService.recordRuntimeUse(resolved.ownerUserId);
    const history: HistoryMessage[] = this.visionHistory(
      userText,
      imageUrls,
      locale,
    );
    const result = await this.llm.complete(
      activeProvider,
      systemPrompt,
      history,
      [],
      locale,
      (usage) => this.recordUsage(activeProvider, usage, false, null),
      // Session-less: no project, and on a background job no caller either —
      // the composer substitutes the placeholder for whichever is missing.
      await this.resolveProxyLabelContext(null),
    );
    return typeof result === 'string' ? result : null;
  }

  // Several frames as history: ONE user message per image (#215).
  //
  // Deliberately shallow. `llm-client` already resolves one image per user
  // message and inlines its `lg` rendition (#113), so this needs no provider
  // builder, no `HistoryMessage` change, no `AIChatMessage` column and no chat
  // export change. Rejected: turning `imageData` into an array and rewriting the
  // Gemini/OpenAI/Ollama/Anthropic builders — that is a repair of the chat core
  // to serve one inventory feature, and models read N captioned messages as well
  // as one multimodal block.
  //
  // The caption is this plugin's business, not the caller's: "one image per
  // message" is an implementation detail of the capability, so the key lives in
  // chat's own locales. If the deep version is ever worth doing, the captions
  // disappear in here and no consumer notices — which is exactly why the caption
  // is not a parameter.
  //
  // Every frame is numbered, and the caller's `userText` rides on the LAST
  // message — so the question follows the evidence rather than preceding it.
  // Both the numbering and the way the question joins it are locale values, not
  // strings assembled here (§5.5).
  private visionHistory(
    userText: string,
    imageUrls: string[],
    locale?: string,
  ): HistoryMessage[] {
    if (imageUrls.length === 0) {
      return [{ role: 'user', content: userText }];
    }
    return imageUrls.map((imageUrl, index) => {
      const last = index === imageUrls.length - 1;
      return {
        role: 'user' as const,
        content: this.i18n.t(
          last ? 'chat.vision.frameCaptionLast' : 'chat.vision.frameCaption',
          { index: index + 1, total: imageUrls.length, question: userText },
          locale,
        ),
        imageData: imageUrl,
      };
    });
  }

  // The same one-shot completion with no picture attached (#206). Mobile intake
  // uses it for the second half of a recognition: the vision call described the
  // photo, and the follow-up question is about that description, so re-sending
  // the image would buy nothing and be billed for.
  async runTextCompletion(
    systemPrompt: string,
    userText: string,
    locale?: string,
  ): Promise<string | null> {
    const resolved = await this.providerService.resolveActiveRuntime();
    if (resolved.status !== 'ready') return null;
    const activeProvider = resolved.config;
    await this.providerService.recordRuntimeUse(resolved.ownerUserId);
    const history: HistoryMessage[] = [{ role: 'user', content: userText }];
    const result = await this.llm.complete(
      activeProvider,
      systemPrompt,
      history,
      [],
      locale,
      (usage) => this.recordUsage(activeProvider, usage, false, null),
      // Session-less: no project, and on a background job no caller either —
      // the composer substitutes the placeholder for whichever is missing.
      await this.resolveProxyLabelContext(null),
    );
    return typeof result === 'string' ? result : null;
  }

  // Persist one usage-telemetry row per LLM call (ticket #55), tagged with the
  // provider/model/connection. Success calls carry token counts; failed calls
  // (isError, no assistant message) are recorded too for error attribution. The
  // row is user-private (scopeId stamped by the policy). Best-effort — a logging
  // failure must never break the chat flow.
  // One accounting row per LLM call. `projectId` is the turn's scope (#130) —
  // the same stamp its messages carry, so a project's spend and its turn list
  // are two readings of one fact instead of a join through a session that no
  // longer names a project. Null on session-less calls (vision one-shots).
  private async recordUsage(
    provider: ProviderConfig,
    usage: LlmUsage | null,
    isError = false,
    sessionId: string | null = null,
    projectId: string | null = null,
  ): Promise<void> {
    try {
      await this.prisma.aIUsageEvent.create({
        data: {
          id: generateUuid(),
          provider: provider.provider,
          providerName: provider.name ?? null,
          modelName: provider.modelName,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          isError,
          sessionId,
          projectId,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to record LLM usage: ${getErrorMessage(error)}`);
    }
  }
}

// What a data URL says about itself, without decoding it (#112). The composer
// only produces these for pictures it picked locally, so there is no filename
// to match an extension against — the mime type is the whole story. The size is
// derived from the base64 length (4 characters carry 3 bytes, minus padding),
// which is exact enough for a limit and costs nothing.
function describeDataUrl(dataUrl: string): AttachmentCandidate | null {
  // [\s\S] instead of the /s flag — the backend's test tsconfig targets
  // pre-ES2018, where that flag does not exist (same trap as parseDataUrl).
  const match = /^data:([^;,]+)[^,]*,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const payload = match[2];
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return {
    filename: null,
    mimeType: match[1],
    sizeBytes: Math.max(0, Math.floor((payload.length * 3) / 4) - padding),
  };
}

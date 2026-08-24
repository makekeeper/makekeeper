import { Injectable } from '@nestjs/common';
import { AgentRegistryService } from '@makekeeper/backend-core';
import {
  AgentTool,
  PermissionLevel,
  parseExternalPermission,
} from '@makekeeper/plugin-contract';
import type { ExternalTokenCeiling } from '../external-types';

// The permission matrix of the two API surfaces (#135).
//
// Why the SCOPED surface is the agent-tool registry rather than a second,
// hand-written CRUD API: every internal plugin ALREADY exposes its operations
// as atomic, permission-classified, i18n-described tools (§5.7). That set IS
// "what the app can do", it is maintained as plugins evolve, and it is already
// tier-classified — writing a parallel REST mirror would duplicate it and
// guarantee drift. External plugins therefore call the same capability layer
// the assistant calls, under an explicit grant.
//
// Two deliberate restrictions on top of the internal semantics:
//   * DESTRUCTIVE tools require the explicit `destructive` access class
//     (#252) — a `write` grant, however broad, never deletes. Until 1.11 the
//     surface denied DESTRUCTIVE structurally; the grant-time consent (with
//     its own warning) is what lifts that, and the MCP face additionally
//     gates every such call on a per-call elicitation confirmation.
//   * The INSTANCE surface never routes here — it is aggregates only, so no
//     amount of `instance:*` grants can reach a record-level operation.

export type SurfaceDecision =
  | { allowed: true; tool: AgentTool }
  | { allowed: false; reason: 'unknown-tool' | 'destructive' | 'forbidden' };

@Injectable()
export class ExternalPermissionsService {
  constructor(private readonly agentRegistry: AgentRegistryService) {}

  // Can this grant set invoke this tool? A higher access implies the lower
  // ones on the same plugin (`destructive` ⊃ `write` ⊃ `read`) — asking
  // authors to list all three would be noise on the consent screen without
  // adding a real decision.
  decide(toolName: string, grants: readonly string[]): SurfaceDecision {
    const tool = this.agentRegistry.getTools().find((t) => t.name === toolName);
    if (!tool) return { allowed: false, reason: 'unknown-tool' };

    const granted = grants.some((raw) => {
      const parsed = parseExternalPermission(raw);
      if (!parsed || parsed.class !== 'scoped') return false;
      if (parsed.target !== tool.pluginId) return false;
      if (tool.permission === PermissionLevel.DESTRUCTIVE) {
        return parsed.access === 'destructive';
      }
      if (tool.permission === PermissionLevel.WRITE) {
        return parsed.access === 'write' || parsed.access === 'destructive';
      }
      return parsed.access !== undefined;
    });
    return granted ? { allowed: true, tool } : this.deniedFor(tool);
  }

  // A destructive miss keeps its own reason so the caller's error names the
  // real obstacle — "this needs the destructive class", not a generic no.
  private deniedFor(tool: AgentTool): SurfaceDecision {
    return {
      allowed: false,
      reason:
        tool.permission === PermissionLevel.DESTRUCTIVE
          ? 'destructive'
          : 'forbidden',
    };
  }

  // Discovery: the tools this grant set may actually call, so a plugin author
  // can enumerate their surface instead of guessing tool names.
  callableTools(grants: readonly string[]): AgentTool[] {
    return this.agentRegistry
      .getTools()
      .filter((tool) => this.decide(tool.name, grants).allowed);
  }

  // ── Connection-token callers (#249) ──────────────────────────────────────
  // No grant set: the caller acts as its issuing user, and the token's
  // CEILING clamps the permission level. Which tools exist at all is the
  // ENABLED set — getEnabledTools() runs the per-request access policy, so
  // under multiuser the user's effective plugin set applies exactly as it
  // does for that user's own assistant ("user ∩ plugin set ∩ ceiling").

  ceilingAllows(
    ceiling: ExternalTokenCeiling,
    permission: PermissionLevel,
  ): boolean {
    if (permission === PermissionLevel.DESTRUCTIVE) {
      // Reachable only under the explicitly-warned `destructive` ceiling
      // (#252); the MCP face additionally gates each call on elicitation.
      // Deliberate deviation from #252's literal "ceiling ∩ destructive
      // grant" wording: a connection token HAS no grant set — the ceiling,
      // chosen with its own warning at issuance, plays the grant's role. The
      // destructive GRANT class gates the other caller kind (plugin tokens).
      return ceiling === 'destructive';
    }
    if (permission === PermissionLevel.WRITE) return ceiling !== 'read-only';
    return true;
  }

  decideForCeiling(
    toolName: string,
    ceiling: ExternalTokenCeiling,
  ): SurfaceDecision {
    const tool = this.agentRegistry.getEnabledTool(toolName);
    if (!tool) return { allowed: false, reason: 'unknown-tool' };
    return this.ceilingAllows(ceiling, tool.permission)
      ? { allowed: true, tool }
      : this.deniedFor(tool);
  }

  callableToolsForCeiling(ceiling: ExternalTokenCeiling): AgentTool[] {
    return this.agentRegistry
      .getEnabledTools()
      .filter((tool) => this.decideForCeiling(tool.name, ceiling).allowed);
  }

  // Hearing is reading (#189 decision 3): an event about an owner's data is
  // gated by a grant that reads that data. A scoped grant qualifies with
  // either access (write implies read, same as on the tool surface); the
  // elevated instance read qualifies too. Capability grants say nothing about
  // data and never qualify.
  canHearDomainEvent(owner: string, grants: readonly string[]): boolean {
    return grants.some((raw) => {
      const parsed = parseExternalPermission(raw);
      if (!parsed || parsed.class === 'capability') return false;
      return parsed.target === owner;
    });
  }

  // Instance surface: which plugins' cross-scope aggregates are readable.
  instanceReadablePlugins(grants: readonly string[]): string[] {
    const targets: string[] = [];
    for (const raw of grants) {
      const parsed = parseExternalPermission(raw);
      if (parsed?.class === 'instance') targets.push(parsed.target);
    }
    return targets;
  }
}

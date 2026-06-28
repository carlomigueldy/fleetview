import type { SessionEvent } from "@fleetview/protocol";
import type { RawEntry } from "../transcript/read";

function targetOf(input: any): string {
  if (!input || typeof input !== "object") return "";
  return input.file_path || input.command || input.pattern || input.path || "";
}

// Strip ANSI SGR escape sequences (e.g. \x1b[1m bold, \x1b[22m reset, \x1b[0m).
// These appear in Claude Code messages when it reports model-switch confirmations
// and other styled output — they render as visible box glyphs in the inspector.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Unwrap slash-command XML wrapper tags that Claude Code embeds in user messages.
// Examples that appear in real transcripts:
//   <command-name>/model</command-name> <command-message>model</command-message>
//   <local-command-stdout>…</local-command-stdout>
//   <local-command-caveat>…</local-command-caveat>
// Strategy: drop label/meta wrappers entirely; keep the prose inside content wrappers.
function unwrapCommandTags(s: string): string {
  // Drop <command-name> and <command-args> entirely (duplicate of the slash-command text)
  s = s.replace(/<command-name>[^<]*<\/command-name>/g, "");
  s = s.replace(/<command-args>[^<]*<\/command-args>/g, "");
  // Keep text inside <command-message> (user-visible confirmation)
  s = s.replace(/<command-message>([\s\S]*?)<\/command-message>/g, "$1");
  // Drop implementation-detail wrappers wholesale
  s = s.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
  s = s.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  // Collapse runs of 3+ whitespace/newlines left by removals into a blank line
  return s.replace(/[ \t]*\n[ \t]*\n[ \t]*\n+/g, "\n\n").trim();
}

// Full sanitization for prose message text: ANSI stripping + command tag unwrapping.
function sanitizeText(s: string): string {
  return unwrapCommandTags(stripAnsi(s));
}

function truncate(c: unknown, n = 200): string {
  const s = typeof c === "string" ? c : JSON.stringify(c);
  // Strip ANSI from tool result content too (bash output can contain escape codes).
  const clean = stripAnsi(s);
  return clean.length > n ? clean.slice(0, n) + "…" : clean;
}

// Real spawn tool names confirmed in spike + "Task" (most common Claude Code subagent spawn):
//   "Agent"      — direct subagent spawn (immediate execution)
//   "Workflow"   — multi-phase workflow spawn (async, scriptPath input)
//   "TaskCreate" — deferred/queued task (SDK sessions)
//   "Task"       — primary Claude Code subagent spawn tool (was missing, causing 7/9 node fallback)
const SPAWN_TOOLS = new Set(["Agent", "Workflow", "TaskCreate", "Task"]);

// Extract the best human-readable label from a spawn tool_use input block.
// Priority: description > subagent_type > subject > first-line of prompt > tool name.
function spawnLabel(input: any, toolName: string): string {
  if (!input || typeof input !== "object") return toolName;
  if (input.description) return String(input.description);
  if (input.subagent_type) return String(input.subagent_type);
  if (input.subject) return String(input.subject);
  if (input.prompt && typeof input.prompt === "string") {
    const firstLine = input.prompt.split(/[\n.]/)[0].trim();
    if (firstLine) return firstLine.slice(0, 50);
  }
  return toolName;
}

export function normalize(entries: RawEntry[]): SessionEvent[] {
  const out: SessionEvent[] = [];
  let seq = 0;

  // ── Pre-pass A: uuid → agentId mapping ──────────────────────────────────────
  // Resolves parentUuid → spawnerAgentId for sidechain agents within the same file.
  // (Cross-file lookups are not possible since each file is normalized independently.)
  const uuidToAgent = new Map<string, string>();
  for (const e of entries) {
    uuidToAgent.set(e.uuid, e.isSidechain && e.agentId ? e.agentId : "main");
  }

  // ── Pre-pass B: sidechain agent info (for unmatched-spawn detection) ─────────
  // Collect unique sidechain hex IDs, their attributionAgent, and inferred spawner.
  // Group by parentUuid so we can compare sidechain count vs spawn tool_use count.
  type SidechainInfo = { hexId: string; sessionId: string; ts: number; attr: string | null; spawner: string };
  const sidechainsByParentUuid = new Map<string, SidechainInfo[]>();
  const seenHexIds = new Set<string>();

  for (const e of entries) {
    if (!e.isSidechain || !e.agentId || seenHexIds.has(e.agentId)) continue;
    seenHexIds.add(e.agentId);

    // parentUuid is internal to this sidechain file; use it to find the spawner only
    // when the uuid actually exists in this file (same-file parent chain).
    const spawner = e.parentUuid && uuidToAgent.has(e.parentUuid)
      ? (uuidToAgent.get(e.parentUuid) ?? "main")
      : "main";

    const key = e.parentUuid ?? "__no_parent__";
    if (!sidechainsByParentUuid.has(key)) sidechainsByParentUuid.set(key, []);
    sidechainsByParentUuid.get(key)!.push({
      hexId: e.agentId,
      sessionId: e.sessionId,
      ts: e.ts,
      attr: e.attributionAgent,
      spawner,
    });
  }

  // ── Pre-pass C: spawn tool_use count per entry uuid ──────────────────────────
  // Used to determine which sidechain agents have no corresponding spawn placeholder.
  const spawnCountByUuid = new Map<string, number>();
  for (const e of entries) {
    const msg = e.message as any;
    const blocks = Array.isArray(msg?.content) ? msg.content : [];
    let count = 0;
    for (const b of blocks) {
      if (b.type === "tool_use" && SPAWN_TOOLS.has(b.name)) count++;
    }
    if (count > 0) spawnCountByUuid.set(e.uuid, count);
  }

  // ── Compute unmatched sidechain agents ───────────────────────────────────────
  // For each parentUuid, the first spawnCount sidechain agents are "matched" to spawn
  // placeholders emitted by that entry.  Remaining agents have no placeholder and need
  // a synthetic subagent_spawn so reduce.ts can assign a readable label (attributionAgent
  // or hex hash fallback) instead of the bare "agent N" ordinal.
  const unmatchedSidechain: SidechainInfo[] = [];
  for (const [key, agents] of sidechainsByParentUuid) {
    const spawnCount = key === "__no_parent__" ? 0 : (spawnCountByUuid.get(key) ?? 0);
    for (let i = spawnCount; i < agents.length; i++) {
      unmatchedSidechain.push(agents[i]);
    }
  }

  // Permission-gate detection: track non-spawn tool_use call IDs that have not
  // yet received a matching tool_result.  If any remain after all entries are
  // processed the agent is blocked on a permission gate or an in-flight tool —
  // both qualify as 'waiting' (clay pip).  The map stores enough context to
  // emit a session_status event using the correct sessionId / agentId / ts.
  type PendingMeta = { sessionId: string; agentId: string; parentAgentId: string | null; ts: number };
  const pendingCallIds = new Map<string, PendingMeta>();
  // Track whether any non-spawn tool_use was encountered, and the last context
  // seen (used to emit a terminal session_status:working when all tools resolve).
  let hasTrackedTools = false;
  let lastTrackedContext: PendingMeta | null = null;

  // ── Main pass ─────────────────────────────────────────────────────────────────
  for (const e of entries) {
    const msg = e.message as any;
    const sessionId = e.sessionId;

    // Sidechain entries carry agentId directly (from the agent-{agentId}.jsonl file).
    // Main-agent entries are always "main".
    const agentId = e.isSidechain && e.agentId ? e.agentId : "main";

    // Resolve the parent of this agent.
    // For "main": no parent.
    // For sidechain agents: use the parentUuid → agentId lookup when the parentUuid
    // refers to an entry in this same file; otherwise fall back to "main".
    const resolvedParentId: string | null = agentId === "main"
      ? null
      : (e.parentUuid && uuidToAgent.has(e.parentUuid)
          ? (uuidToAgent.get(e.parentUuid) ?? "main")
          : "main");

    const baseFor = (aId: string) => ({
      sessionId,
      agentId: aId,
      parentAgentId: aId === "main" ? null : resolvedParentId,
      ts: e.ts,
    });

    const content = msg?.content;
    const blocks = Array.isArray(content)
      ? content
      : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];

    // Emit token_usage when the assistant message carries usage metadata.
    // Claude transcripts attach message.usage.{input_tokens,output_tokens} and
    // optionally message.model to assistant turns.
    // Cache tokens (cache_read_input_tokens, cache_creation_input_tokens) count
    // toward billed input usage and must be included so the 'tokens' stat in the
    // inspector reflects real consumption rather than landing as 0 when the model
    // serves most context from cache.
    if (msg?.role === "assistant" && msg.usage) {
      out.push({
        ...baseFor(agentId),
        seq: seq++,
        kind: "token_usage",
        inTokens:
          (msg.usage.input_tokens ?? 0) +
          (msg.usage.cache_read_input_tokens ?? 0) +
          (msg.usage.cache_creation_input_tokens ?? 0),
        outTokens: msg.usage.output_tokens ?? 0,
        ...(msg.model ? { model: msg.model as string } : {}),
      });
    }

    for (const b of blocks) {
      if (b.type === "text" && b.text) {
        const cleanText = sanitizeText(b.text);
        if (!cleanText) continue; // skip if sanitization reduces to empty (pure command meta)
        out.push({
          ...baseFor(agentId),
          seq: seq++,
          kind: "message",
          role: msg.role ?? "assistant",
          text: cleanText,
        });
      } else if (b.type === "tool_use" && SPAWN_TOOLS.has(b.name)) {
        // Label priority: description > subagent_type > subject > prompt first-line > tool name.
        // "Task" tool uses input.prompt; others use description/subagent_type.
        const label = spawnLabel(b.input, b.name);
        out.push({
          sessionId,
          agentId: b.id,
          // Use the spawning agent (agentId) as parentAgentId, not the hardcoded "main".
          // This enables true multi-depth colony trees when a sidechain agent spawns sub-agents.
          parentAgentId: agentId,
          ts: e.ts,
          seq: seq++,
          kind: "subagent_spawn",
          label,
        });
      } else if (b.type === "tool_use") {
        // Track this call id as pending until a matching tool_result clears it.
        const parentAgentId = agentId === "main" ? null : resolvedParentId;
        const ctx: PendingMeta = { sessionId, agentId, parentAgentId, ts: e.ts };
        pendingCallIds.set(b.id, ctx);
        hasTrackedTools = true;
        lastTrackedContext = ctx;
        out.push({
          ...baseFor(agentId),
          seq: seq++,
          kind: "tool_call",
          callId: b.id,
          tool: b.name,
          target: targetOf(b.input),
        });
      } else if (b.type === "tool_result") {
        // Clear the matching pending entry — the tool has returned a result.
        pendingCallIds.delete(b.tool_use_id);
        // Update context so the terminal working/waiting status event has correct ts.
        if (lastTrackedContext) {
          const updated: PendingMeta = { sessionId: lastTrackedContext.sessionId, agentId: lastTrackedContext.agentId, parentAgentId: lastTrackedContext.parentAgentId, ts: e.ts };
          lastTrackedContext = updated;
        }
        out.push({
          ...baseFor(agentId),
          seq: seq++,
          kind: "tool_result",
          callId: b.tool_use_id,
          ok: !b.is_error,
          summary: truncate(b.content),
        });
      }
    }
  }

  // Only emit session_status:'waiting' when tool calls are genuinely pending.
  // We do NOT emit session_status:'working' here — the mtime heuristic in
  // EventLog.sessions() already yields 'working' for recently-modified sessions,
  // and emitting an explicit 'working' would latch EventLog.lastStatus permanently
  // (the recency gate that prevents stale 'working' latches only works when the
  // mtime is also fresh, but a scan of stale files re-emits the same events via
  // seq-idempotent append, making the 'working' latch truly sticky without the gate).
  // Emitting nothing lets EventLog fall back to mtime, which is always correct.
  if (hasTrackedTools && pendingCallIds.size > 0) {
    const meta = [...pendingCallIds.values()].at(-1)!;
    out.push({
      sessionId: meta.sessionId,
      agentId: meta.agentId,
      parentAgentId: meta.parentAgentId,
      seq: seq++,
      ts: meta.ts,
      kind: "session_status",
      status: "waiting",
    });
  }

  // ── Synthetic subagent_spawn for unmatched sidechain agents ──────────────────
  // Sidechain agents without a corresponding SPAWN_TOOLS tool_use would otherwise
  // fall back to "agent N" ordinal labels in reduce.ts ensure().  Emitting synthetic
  // spawn events at the END of the sequence (higher seq) ensures reduce.ts has a
  // chance to overwrite any existing "agent N" labels with the correct attributionAgent
  // value, while still allowing the reconciliation path to handle matched agents.
  for (const info of unmatchedSidechain) {
    const label = info.attr || null;
    if (!label) continue; // skip if no attributionAgent — let ensure() handle it
    out.push({
      sessionId: info.sessionId,
      agentId: info.hexId,
      parentAgentId: info.spawner === info.hexId ? "main" : info.spawner, // self-parent guard
      ts: info.ts,
      seq: seq++,
      kind: "subagent_spawn",
      label,
    });
  }

  return out;
}

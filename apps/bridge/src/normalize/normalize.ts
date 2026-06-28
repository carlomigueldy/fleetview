import type { SessionEvent } from "@fleetview/protocol";
import type { RawEntry } from "../transcript/read";

function targetOf(input: any): string {
  if (!input || typeof input !== "object") return "";
  return input.file_path || input.command || input.pattern || input.path || "";
}

function truncate(c: unknown, n = 200): string {
  const s = typeof c === "string" ? c : JSON.stringify(c);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Real spawn tool names confirmed in spike:
//   "Agent"      — direct subagent spawn (immediate execution)
//   "Workflow"   — multi-phase workflow spawn (async, scriptPath input)
//   "TaskCreate" — deferred/queued task (SDK sessions)
const SPAWN_TOOLS = new Set(["Agent", "Workflow", "TaskCreate"]);

export function normalize(entries: RawEntry[]): SessionEvent[] {
  const out: SessionEvent[] = [];
  let seq = 0;

  for (const e of entries) {
    const msg = e.message as any;
    const sessionId = e.sessionId;

    // Sidechain entries carry agentId directly (from the agent-{agentId}.jsonl file).
    // Main-agent entries are always "main".
    const agentId = e.isSidechain && e.agentId ? e.agentId : "main";

    const baseFor = (aId: string) => ({
      sessionId,
      agentId: aId,
      parentAgentId: aId === "main" ? null : "main",
      ts: e.ts,
    });

    const content = msg?.content;
    const blocks = Array.isArray(content)
      ? content
      : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];

    for (const b of blocks) {
      if (b.type === "text" && b.text) {
        out.push({
          ...baseFor(agentId),
          seq: seq++,
          kind: "message",
          role: msg.role ?? "assistant",
          text: b.text,
        });
      } else if (b.type === "tool_use" && SPAWN_TOOLS.has(b.name)) {
        // Label priority: description > subagent_type > subject > tool name
        const label =
          b.input?.description ||
          b.input?.subagent_type ||
          b.input?.subject ||
          b.name;
        out.push({
          sessionId,
          agentId: b.id,
          parentAgentId: "main",
          ts: e.ts,
          seq: seq++,
          kind: "subagent_spawn",
          label,
        });
      } else if (b.type === "tool_use") {
        out.push({
          ...baseFor(agentId),
          seq: seq++,
          kind: "tool_call",
          callId: b.id,
          tool: b.name,
          target: targetOf(b.input),
        });
      } else if (b.type === "tool_result") {
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
  return out;
}

import type { SessionEvent } from "@fleetview/protocol";
export function describeEvent(e: SessionEvent): { actor: string; text: string } | null {
  switch (e.kind) {
    case "subagent_spawn": return { actor: e.agentId, text: `spawned subagent ${e.label}` };
    case "tool_call": return { actor: e.agentId, text: `${e.tool} ${e.target}`.trim() };
    case "tool_result": return { actor: e.agentId, text: `${e.ok ? "✓" : "✗"} ${e.summary}` };
    case "subagent_exit": return { actor: e.agentId, text: `exited (${e.status})` };
    case "message": return e.role === "assistant" ? { actor: e.agentId, text: e.text.slice(0, 80) } : null;
    default: return null;
  }
}

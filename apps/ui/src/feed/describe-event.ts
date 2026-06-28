import type { SessionEvent } from "@fleetview/protocol";
import { labelFor } from "../store/reduce";

export function describeEvent(e: SessionEvent): { actor: string; text: string; detail?: string } | null {
  // Apply the same hex-truncation as the colony tree so actor labels in the
  // activity feed match the short-hash names shown on colony nodes
  // (e.g. "a25c755" instead of the raw "a25c755c15b3975c0").
  const actor = labelFor(e.agentId);
  switch (e.kind) {
    case "subagent_spawn": return { actor, text: "spawned subagent", detail: e.label };
    case "tool_call": return { actor, text: e.tool, ...(e.target ? { detail: e.target.split("\n")[0].slice(0, 40) } : {}) };
    case "tool_result": {
      // Truncate to first non-empty line capped at 40 chars — mirrors tool_call treatment.
      // This prevents base64 blobs and multi-line outputs from overflowing the feed row.
      const firstLine = e.summary.split("\n").find((l) => l.trim()) ?? "";
      const summary = firstLine.slice(0, 40) || e.summary.slice(0, 40);
      return { actor, text: `${e.ok ? "✓" : "✗"} ${summary}` };
    }
    case "subagent_exit": return { actor, text: `exited (${e.status})` };
    case "message": return e.role === "assistant" ? { actor, text: e.text.slice(0, 60) } : null;
    default: return null;
  }
}

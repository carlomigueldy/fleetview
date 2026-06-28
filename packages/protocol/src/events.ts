import { z } from "zod";

export type AgentStatus = "working" | "waiting" | "idle" | "done" | "error";

const StatusSchema = z.enum(["working", "waiting", "idle", "done", "error"]);

const Base = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  parentAgentId: z.string().nullable(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
});

export const SessionEventSchema = z.discriminatedUnion("kind", [
  Base.extend({ kind: z.literal("message"), role: z.enum(["user", "assistant", "system"]), text: z.string() }),
  Base.extend({ kind: z.literal("tool_call"), callId: z.string(), tool: z.string(), target: z.string() }),
  Base.extend({ kind: z.literal("tool_result"), callId: z.string(), ok: z.boolean(), summary: z.string() }),
  Base.extend({ kind: z.literal("subagent_spawn"), label: z.string() }),
  Base.extend({ kind: z.literal("subagent_exit"), status: StatusSchema }),
  Base.extend({ kind: z.literal("session_status"), status: StatusSchema }),
  Base.extend({ kind: z.literal("token_usage"), inTokens: z.number().int(), outTokens: z.number().int() }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;

export function parseSessionEvent(u: unknown): SessionEvent {
  return SessionEventSchema.parse(u);
}

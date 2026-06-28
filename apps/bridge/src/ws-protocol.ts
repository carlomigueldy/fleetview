import type { SessionEvent, AgentStatus } from "@fleetview/protocol";
export type ClientMsg = { type: "subscribe"; sessionId: string; afterSeq: number } | { type: "list" };
export type SessionMeta = { sessionId: string; cwd: string; label: string; mtimeMs: number; status: AgentStatus; agentCount: number };
export type ServerMsg = { type: "events"; events: SessionEvent[] } | { type: "sessions"; sessions: SessionMeta[] };

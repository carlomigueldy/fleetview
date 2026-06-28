import type { SessionEvent } from "@fleetview/protocol";
export type ClientMsg = { type: "subscribe"; sessionId: string; afterSeq: number } | { type: "list" };
export type ServerMsg = { type: "events"; events: SessionEvent[] } | { type: "sessions"; sessions: string[] };

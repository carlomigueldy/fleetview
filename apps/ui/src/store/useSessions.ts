import { useEffect, useState } from "react";
import type { AgentStatus } from "@fleetview/protocol";
import type { SessionSummary } from "../components/Sidebar";

/** Mirrors the SessionMeta shape emitted by the bridge ws-protocol. */
interface SessionMeta {
  sessionId: string;
  cwd: string;
  label: string;
  mtimeMs: number;
  status?: AgentStatus;
  agentCount?: number;
}

export type SessionsStatus = "connecting" | "ready" | "error";

export function useSessions(): { sessions: SessionSummary[]; status: SessionsStatus } {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [status, setStatus] = useState<SessionsStatus>("connecting");

  useEffect(() => {
    let alive = true;
    let retryDelay = 500;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        if (!alive) return;
        retryDelay = 500; // reset backoff on successful open
        ws!.send(JSON.stringify({ type: "list" }));
      };
      ws.onmessage = (m) => {
        if (!alive) return;
        try {
          const msg = JSON.parse(m.data as string);
          if (msg.type === "sessions") {
            const mapped = (msg.sessions as SessionMeta[])
              .map((s) => ({
                sessionId: s.sessionId,
                label: s.label || s.sessionId.slice(0, 8),
                cwd: s.cwd ?? "",
                mtimeMs: s.mtimeMs ?? 0,
                status: s.status ?? ("idle" as AgentStatus),
                agentCount: s.agentCount ?? 1,
              }))
              .sort((a, b) => b.mtimeMs - a.mtimeMs);
            setSessions(mapped);
            setStatus("ready");
          }
        } catch (err) {
          // Malformed or unexpected frame — log so shape/version mismatches surface.
          console.warn("[useSessions] failed to parse WS frame:", err, m.data);
        }
      };
      ws.onerror = () => {
        if (alive) setStatus((s) => (s === "ready" ? s : "error"));
      };
      ws.onclose = () => {
        if (!alive) return;
        // Bounded exponential backoff: 500ms → 1s → 2s → … → 5s cap.
        retryTimer = setTimeout(() => {
          if (alive) connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      };
    }

    connect();

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  return { sessions, status };
}

import { useEffect, useState } from "react";
import type { SessionSummary } from "../components/Sidebar";

export function useSessions(): SessionSummary[] {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "list" }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type === "sessions") setSessions(msg.sessions.map((id: string) => ({ sessionId: id, label: id.slice(0, 8), status: "idle" as const })));
    };
    return () => ws.close();
  }, []);
  return sessions;
}

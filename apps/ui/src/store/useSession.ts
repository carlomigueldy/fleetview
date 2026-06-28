import { useEffect, useRef, useState } from "react";
import type { SessionEvent } from "@fleetview/protocol";
import { emptyState, reduce, type SessionState } from "./reduce";

export function useSession(sessionId: string | null): SessionState {
  const [state, setState] = useState<SessionState>(emptyState());
  const ref = useRef<SessionState>(state);
  useEffect(() => {
    if (!sessionId) return;
    ref.current = emptyState(); setState(ref.current);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", sessionId, afterSeq: -1 }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type !== "events") return;
      for (const ev of msg.events as SessionEvent[]) ref.current = reduce(ref.current, ev);
      setState({ ...ref.current });
    };
    return () => ws.close();
  }, [sessionId]);
  return state;
}

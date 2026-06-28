import { useEffect, useRef, useState } from "react";
import type { SessionEvent } from "@fleetview/protocol";
import { emptyState, reduce, type SessionState } from "./reduce";

// Cap the retained event log to prevent unbounded memory growth on long-running
// live streams.  Set well above the largest realistic single-session backlog so
// that the full backlog replay (typically ≤20 000 events from the bridge) is
// always retained — this keeps the inspector header stats (derived from the full
// agents map) consistent with the inspector body (derived from the event window).
// Only long-lived live sessions that continue streaming after initial load will
// ever approach this ceiling.
const MAX_EVENTS = 25_000;

export function useSession(sessionId: string | null): SessionState {
  const [state, setState] = useState<SessionState>(emptyState());
  const ref = useRef<SessionState>(state);
  useEffect(() => {
    if (!sessionId) return;
    ref.current = emptyState(); setState(ref.current);
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
        // Resume from last seen seq so we don't replay the full backlog on reconnect.
        ws!.send(JSON.stringify({ type: "subscribe", sessionId, afterSeq: ref.current.lastSeq }));
      };
      ws.onmessage = (m) => {
        if (!alive) return;
        let msg: any;
        try {
          msg = JSON.parse(m.data as string);
        } catch (err) {
          console.warn("[useSession] bad frame", err);
          return;
        }
        if (msg.type !== "events") return;
        const batchEvs = msg.events as SessionEvent[];
        if (batchEvs.length === 0) return;
        // Process agent-map updates one at a time (Map clone is cheap — small N).
        // Accumulate events array once for the whole batch — avoids O(K²) spreading.
        const prevEvents = ref.current.events;
        for (const ev of batchEvs) ref.current = reduce(ref.current, ev);
        // Cap at MAX_EVENTS: drop oldest events from the front to bound memory growth.
        // Merge first, then slice — a single batch >= MAX_EVENTS would otherwise bypass
        // the cap entirely (prevEvents.slice would yield [] and next = the full batch).
        const merged = [...prevEvents, ...batchEvs];
        const next = merged.length > MAX_EVENTS ? merged.slice(-MAX_EVENTS) : merged;
        ref.current = { ...ref.current, events: next };
        setState({ ...ref.current });
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
  }, [sessionId]);
  return state;
}

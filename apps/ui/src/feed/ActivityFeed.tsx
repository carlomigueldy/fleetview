import { useState, useEffect, useMemo } from "react";
import type { SessionState } from "../store/reduce";
import { labelFor } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";
import { describeEvent } from "./describe-event";

// Derive the last tool_call from a waiting agent for the permission card display.
// Early-returns null when no agent is in 'waiting' state to avoid scanning all events.
function findWaitingTool(state: SessionState): { agentId: string; tool: string; target: string } | null {
  const waitingAgentId = [...state.agents.values()].find((a) => a.status === "waiting")?.agentId ?? null;
  if (!waitingAgentId) return null;
  // Walk events in reverse — only scan tail when we know a waiting agent exists.
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.kind === "tool_call" && e.agentId === waitingAgentId) {
      return { agentId: waitingAgentId, tool: e.tool, target: e.target };
    }
  }
  return { agentId: waitingAgentId, tool: "unknown", target: "" };
}

// Compute a compact relative-age badge anchored to wall-clock now.
// Result: "00s" if the event just happened, ascending as events age; "mm:ss"
// when >= 60s to avoid 4-digit second counts (matches mockup's compact badges).
function relSec(rowTs: number, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - rowTs) / 1000));
  if (secs < 60) return String(secs).padStart(2, "0") + "s";
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const h = Math.floor(secs / 3600);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function ActivityFeed({ state, sessionLabel }: { state: SessionState; sessionLabel?: string }) {
  // Wall-clock now — updated every second so badges show true elapsed age even
  // when the session is idle and no new events arrive to trigger re-renders.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Map only the tail slice to rows — avoids O(n) work per second as events accumulate.
  // Memoized on state.events identity so the 1 s nowMs tick only re-renders badge text.
  type Row = { actor: string; text: string; detail?: string; ts: number };
  const displayRows = useMemo<Row[]>(() => {
    const tail = state.events.slice(-30);
    const rows: Row[] = [];
    for (const e of tail) {
      const d = describeEvent(e as SessionEvent);
      if (d) rows.push({ ...d, ts: e.ts });
    }
    return rows.reverse();
  }, [state.events]);

  const waitingTool = useMemo(() => findWaitingTool(state), [state.agents, state.events]);

  return (
    <aside className="border-l border-hairline flex flex-col h-full overflow-hidden">
      {/* Non-scrolling ACTIVITY header — mirrors SESSIONS header in Sidebar */}
      <div className="shrink-0 px-4 pt-5 pb-3">
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: "var(--color-muted)" }}>
          Activity
        </div>
      </div>

      {/* Scrollable event feed — overflow-x hidden prevents long command strings
          or base64 blobs from creating a horizontal scrollbar in the right panel. */}
      <div className="flex-1 overflow-y-auto px-4" style={{ overflowX: "hidden" }}>
        {displayRows.map((row, i) => (
          <div
            key={`${row.actor}:${row.ts}:${i}`}
            className="border-b border-hairline"
            style={{ fontSize: 12.5, padding: "9px 0", display: "flex", gap: 10, color: "var(--color-slate)", minWidth: 0 }}
          >
            {/* Mono time badge — anchored to wall-clock so it shows true elapsed age */}
            <span className="font-mono flex-none" style={{ fontSize: 10.5, color: "var(--color-muted)" }}>
              {relSec(row.ts, nowMs)}
            </span>
            {/* Actor + description + optional clay detail — min-width:0 lets flex shrink */}
            <span style={{ minWidth: 0, overflow: "hidden" }}>
              <b style={{ color: "var(--color-ink)", fontWeight: 600 }}>{row.actor}</b>
              {" "}{row.text}
              {row.detail && (
                <> <span style={{ color: "var(--color-clay)", wordBreak: "break-all" }}>{row.detail}</span></>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Permission / attention card — pinned to bottom OUTSIDE the scroll area.
          Shown only when an agent is verifiably in the 'waiting' state. */}
      {waitingTool && (
        <div
          style={{
            flexShrink: 0,
            margin: "12px 16px 16px",
            border: "1px solid var(--color-clay)",
            background: "var(--color-paper)",
            borderRadius: 14,
            padding: 15,
            boxShadow: "0 10px 30px -16px rgba(201,100,66,.5)",
          }}
        >
          <div
            className="font-mono"
            style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--color-clay)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}
          >
            ⚠ permission · {sessionLabel ?? labelFor(waitingTool.agentId)}
          </div>
          <code
            className="font-mono"
            style={{
              display: "block",
              fontSize: 11.5,
              color: "var(--color-slate)",
              background: "var(--color-cream)",
              padding: "9px 11px",
              borderRadius: 9,
              margin: "10px 0",
              border: "1px solid var(--color-hairline)",
            }}
          >
            {waitingTool.tool === "Bash"
              ? `$ ${waitingTool.target}`
              : `${waitingTool.tool}${waitingTool.target ? ` ${waitingTool.target}` : ""}`}
          </code>
          <div style={{ display: "flex", gap: 8 }}>
            {/* Observe-MVP: no control channel to Claude Code yet — no-op with tooltip.
                Rendered at full mockup strength (clay / ghost) so the card reads as
                a real alert; aria-disabled signals non-interactivity to AT without
                washing the color out. */}
            <button
              aria-disabled="true"
              title="Allow/deny requires a live control channel — coming soon"
              onClick={(e) => e.preventDefault()}
              style={{
                flex: 1, textAlign: "center", fontSize: 12.5, fontWeight: 600,
                padding: 9, borderRadius: 10, cursor: "default",
                background: "var(--color-clay)", color: "#fff", border: "none",
              }}
            >
              Allow
            </button>
            <button
              aria-disabled="true"
              title="Allow/deny requires a live control channel — coming soon"
              onClick={(e) => e.preventDefault()}
              style={{
                flex: 1, textAlign: "center", fontSize: 12.5, fontWeight: 600,
                padding: 9, borderRadius: 10, cursor: "default",
                color: "var(--color-slate)", border: "1px solid var(--color-hairline)",
                background: "transparent",
              }}
            >
              Deny
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

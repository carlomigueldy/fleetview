import type { AgentStatus } from "@fleetview/protocol";
export type SessionSummary = { sessionId: string; label: string; cwd: string; mtimeMs: number; status: AgentStatus; agentCount?: number };
const pip: Record<AgentStatus, string> = { working: "var(--color-sage)", waiting: "var(--color-clay)", idle: "var(--color-idle)", done: "var(--color-idle)", error: "var(--color-clay)" };

function shortCwd(cwd: string): string {
  if (!cwd) return "";
  // Replace /home/<user> or /Users/<user> with ~
  return cwd.replace(/^\/(?:home|Users)\/[^/]+/, "~");
}

// Human-readable relative age for the session's last transcript modification.
// Used as a per-row differentiator when many sessions share the same label + cwd
// (e.g. all fleetview sessions on branch feat/observe-mvp).
export function relativeTime(mtimeMs: number): string {
  if (!mtimeMs) return "";
  const secs = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusDescriptor(status: AgentStatus, agentCount?: number): string {
  if (status === "working") {
    // Show agent count when more than the single root agent is active.
    // Label is "N agents seen" (not "N nodes") because the bridge counts all hex
    // sidechain IDs seen in events; the colony tree only renders nodes reachable
    // from 'main', so orphan sidechain agents are counted but not drawn.
    return agentCount && agentCount > 1 ? `${agentCount} agents seen` : "working";
  }
  if (status === "waiting") return "awaiting you";
  if (status === "done") return "done";
  if (status === "error") return "error";
  return "idle";
}

export function Sidebar({ sessions, activeId, onSelect, status }: { sessions: SessionSummary[]; activeId: string | null; onSelect: (id: string) => void; status?: "connecting" | "ready" | "error" }) {
  return (
    <aside className="border-r border-hairline flex flex-col h-full min-h-0">
      {/* Non-scrolling SESSIONS header */}
      <div className="shrink-0 px-5 pt-5 pb-3">
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: "var(--color-muted)" }}>Sessions</div>
      </div>

      {/* Scrollable session list — min-h-0 lets this flex child shrink below its content */}
      <div className="flex-1 overflow-y-auto min-h-0 px-[14px] pb-4">
        <ul>
          {/* Skeleton loading state — 3 placeholder rows while bridge connection is opening */}
          {sessions.length === 0 && status === "connecting" && (
            <>
              <li><div className="h-9 rounded-xl animate-pulse mb-[7px]" style={{ background: "var(--color-hairline)" }} /></li>
              <li><div className="h-9 rounded-xl animate-pulse mb-[7px]" style={{ background: "var(--color-hairline)" }} /></li>
              <li><div className="h-9 rounded-xl animate-pulse" style={{ background: "var(--color-hairline)" }} /></li>
            </>
          )}
          {sessions.length === 0 && status === "error" && (
            <li>
              <p className="text-[12px] text-center pt-8 font-mono" style={{ color: "var(--color-clay)" }}>bridge unreachable</p>
            </li>
          )}
          {sessions.length === 0 && status === "ready" && (
            <li>
              <p className="text-[12px] text-center pt-8" style={{ color: "var(--color-muted)" }}>No sessions found</p>
            </li>
          )}
          {sessions.map((s) => {
            const isActive = activeId === s.sessionId;
            const cwdShort = shortCwd(s.cwd ?? "");
            const age = relativeTime(s.mtimeMs);
            const statusStr = statusDescriptor(s.status, s.agentCount);
            // Primary meta line mirrors the mockup exactly: "cwd · status".
            // The age differentiator (needed to distinguish 230+ same-named sessions) is
            // moved to a right-aligned secondary slot so it doesn't displace the primary
            // line from the approved card layout.
            const primaryMeta = [cwdShort, statusStr].filter(Boolean).join(" · ");
            return (
              <li key={s.sessionId}>
                <button
                  onClick={() => onSelect(s.sessionId)}
                  className={`w-full text-left rounded-xl transition-colors focus:outline-none focus-visible:ring-2 ${isActive ? "bg-paper" : "hover:bg-[var(--color-cream2)]"}`}
                  style={{
                    padding: "11px 12px",
                    marginBottom: 7,
                    ...(isActive ? { boxShadow: "0 1px 0 var(--color-hairline), 0 6px 20px -12px rgba(60,40,20,.3)" } : {}),
                  }}
                >
                  {/* gap-[9px] matches mockup .sess h4 gap:9px */}
                  <div className="flex items-center" style={{ gap: 9 }}>
                    <span
                      className="rounded-full flex-none"
                      style={{ width: 7, height: 7, background: pip[s.status] }}
                    />
                    <span className="text-[13.5px] font-semibold">{s.label}</span>
                  </div>
                  {/* margin-top:5px matches mockup .sess p margin-top:5px.
                      Age is right-aligned so the primary "cwd · status" line
                      matches the approved card layout exactly. */}
                  <p
                    className="font-mono text-[10.5px]"
                    style={{ marginTop: 5, color: "var(--color-muted)", display: "flex", justifyContent: "space-between", gap: 4 }}
                  >
                    <span>{primaryMeta}</span>
                    {age && <span style={{ opacity: 0.65, flexShrink: 0 }}>{age}</span>}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

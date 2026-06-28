import type { AgentStatus } from "@fleetview/protocol";
export type SessionSummary = { sessionId: string; label: string; status: AgentStatus };
const pip: Record<AgentStatus, string> = { working: "var(--color-sage)", waiting: "var(--color-clay)", idle: "var(--color-idle)", done: "var(--color-idle)", error: "var(--color-clay)" };

export function Sidebar({ sessions, activeId, onSelect }: { sessions: SessionSummary[]; activeId: string | null; onSelect: (id: string) => void }) {
  return (
    <aside className="border-r border-hairline p-4">
      <h1 className="font-display text-xl mb-4">FleetView</h1>
      <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-3 font-mono">Sessions</div>
      <ul>
        {sessions.map((s) => (
          <li key={s.sessionId}>
            <button onClick={() => onSelect(s.sessionId)}
              className={`w-full text-left rounded-xl px-3 py-2.5 mb-1.5 flex items-center gap-2 ${activeId === s.sessionId ? "bg-paper shadow" : "hover:bg-[var(--color-hairline)]/40"}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: pip[s.status] }} />
              <span className="text-sm font-semibold">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

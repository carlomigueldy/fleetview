import type { SessionState } from "../store/reduce";
import { selectAgentEvents } from "./select-agent-events";

export function NodeInspector({ state, agentId, onClose }: { state: SessionState; agentId: string | null; onClose: () => void }) {
  if (!agentId) return null;
  const node = state.agents.get(agentId);
  const events = selectAgentEvents(state, agentId);
  return (
    <aside className="border-l border-hairline bg-paper h-full flex flex-col">
      <header className="p-5 border-b border-hairline">
        <div className="font-mono text-[10.5px] text-muted">{agentId}</div>
        <h3 className="font-display text-2xl mt-2 flex items-center gap-2">{node?.label ?? agentId}</h3>
        <div className="flex gap-4 mt-3 font-mono text-[11px] text-muted">
          <span>tools <b className="text-ink">{node?.tools ?? 0}</b></span>
          <span>tokens <b className="text-ink">{node?.tokens ?? 0}</b></span>
          <span>status <b className="text-ink">{node?.status}</b></span>
        </div>
        <button onClick={onClose} className="sr-only">Close</button>
      </header>
      <div className="flex-1 overflow-auto p-5 space-y-3">
        {events.map((e, i) => {
          if (e.kind === "message") return <p key={i} className="text-sm leading-relaxed">{e.text}</p>;
          if (e.kind === "tool_call") return (
            <div key={i} className="border border-hairline rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-cream font-mono text-[11.5px]"><span className="text-clay">▸</span><b className="font-medium">{e.tool}</b><span className="text-muted">{e.target}</span></div>
            </div>
          );
          if (e.kind === "tool_result") return <div key={i} className="font-mono text-[11px] text-slate px-3">{e.ok ? "✓" : "✗"} {e.summary}</div>;
          return null;
        })}
      </div>
    </aside>
  );
}

import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { useSessions } from "./store/useSessions";
import { useSession } from "./store/useSession";
import { ColonyTree } from "./tree/ColonyTree";
import { NodeInspector } from "./inspector/NodeInspector";
import { ActivityFeed } from "./feed/ActivityFeed";

export function App() {
  const { sessions, status } = useSessions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const session = useSession(activeId);
  const activeCount = sessions.filter((s) => s.status === "working" || s.status === "waiting").length;
  return (
    <div
      data-testid="app-shell"
      className="h-screen grid overflow-hidden"
      style={{ gridTemplateColumns: selectedAgent ? "240px 1fr 416px" : "240px 1fr 300px", gridTemplateRows: "58px 1fr" }}
    >
      {/* Top bar — spans all columns */}
      <header
        className="flex items-center gap-3.5 border-b"
        style={{
          gridColumn: "1 / -1",
          padding: "0 24px",
          borderColor: "var(--color-hairline)",
        }}
      >
        <div className="font-display font-semibold text-[21px] flex items-center gap-2.5" style={{ letterSpacing: "-0.01em" }}>
          <span
            className="rounded-full"
            style={{
              width: 9,
              height: 9,
              background: "var(--color-clay)",
              animation: "breathe 2.4s ease-in-out infinite",
            }}
          />
          FleetView
        </div>
        <span
          className="font-mono text-[11px] border rounded-full"
          style={{ padding: "3px 9px", color: "var(--color-muted)", borderColor: "var(--color-hairline)" }}
        >
          colony · {activeCount} active
        </span>
        <div className="flex-1" />
        <span
          className="font-mono text-[11px] border rounded-full"
          style={{ padding: "3px 9px", color: "var(--color-muted)", borderColor: "var(--color-hairline)" }}
        >
          ⎇ local bridge
        </span>
        <span
          className="font-mono text-[11px] border rounded-full"
          style={{ padding: "3px 9px", color: "var(--color-muted)", borderColor: "var(--color-hairline)" }}
        >
          ◆ your CLI auth
        </span>
        {/* Observe-MVP: session launching requires a control channel — disabled until wired.
            Rendered at full ink strength to match the mockup; click is a no-op with tooltip. */}
        <button
          aria-disabled="true"
          title="Launching sessions requires a live control channel — coming soon"
          onClick={(e) => e.preventDefault()}
          className="text-[12.5px] font-semibold text-white rounded-[9px] border-0"
          style={{ background: "var(--color-ink)", padding: "7px 14px", cursor: "default" }}
        >
          + New session
        </button>
      </header>

      <Sidebar sessions={sessions} activeId={activeId} onSelect={(id) => { setActiveId(id); setSelectedAgent(null); }} status={status} />
      <main className="relative overflow-hidden min-h-0" data-agent-count={session.agents.size}>
        {activeId && <ColonyTree agents={session.agents} onSelect={setSelectedAgent} selectedId={selectedAgent} />}

        {/* Hero overlay — visible always, sits above canvas (pointer-events:none) */}
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 34,
            zIndex: 3,
            pointerEvents: "none",
            maxWidth: "30ch",
          }}
        >
          {activeId ? (
            <>
              <div
                className="font-mono"
                style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--color-clay)", textTransform: "uppercase" }}
              >
                {sessions.find((s) => s.sessionId === activeId)?.label ?? activeId.slice(0, 8)} · live colony
              </div>
              <h1
                className="font-display"
                style={{ fontWeight: 600, fontSize: 40, lineHeight: 1.02, letterSpacing: "-0.02em", margin: "12px 0 10px" }}
              >
                Watch your agents{" "}
                <em style={{ fontStyle: "italic", color: "var(--color-clay)" }}>think.</em>
              </h1>
              <p style={{ color: "var(--color-slate)", fontSize: 14, lineHeight: 1.55 }}>
                Every subagent and workflow branch, blooming from one root — drawn in ink, in real time.
              </p>
            </>
          ) : (
            <>
              <div
                className="font-mono"
                style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--color-muted)", textTransform: "uppercase" }}
              >
                colony · select a session
              </div>
              <h1
                className="font-display"
                style={{ fontWeight: 600, fontSize: 40, lineHeight: 1.02, letterSpacing: "-0.02em", margin: "12px 0 10px", color: "var(--color-ink)" }}
              >
                Watch your agents{" "}
                <em style={{ fontStyle: "italic", color: "var(--color-clay)" }}>think.</em>
              </h1>
              <p style={{ color: "var(--color-slate)", fontSize: 14, lineHeight: 1.55 }}>
                Pick a session from the sidebar to see its live colony tree.
              </p>
            </>
          )}
        </div>

        {/* Status legend — pinned bottom-left */}
        <div
          className="font-mono"
          style={{
            position: "absolute",
            left: 40,
            bottom: 26,
            zIndex: 3,
            fontSize: 11,
            color: "var(--color-muted)",
            display: "flex",
            gap: 18,
            pointerEvents: "none",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-sage)", flexShrink: 0, display: "inline-block" }} />
            working
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-clay)", flexShrink: 0, display: "inline-block" }} />
            waiting on you
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C3BBA9", flexShrink: 0, display: "inline-block" }} />
            idle
          </span>
        </div>
      </main>
      {selectedAgent
        ? <NodeInspector state={session} agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
        : <ActivityFeed state={session} sessionLabel={sessions.find((s) => s.sessionId === activeId)?.label ?? activeId?.slice(0, 8)} />}
    </div>
  );
}

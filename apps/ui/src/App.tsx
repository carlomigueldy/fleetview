import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { useSessions } from "./store/useSessions";
import { useSession } from "./store/useSession";
import { ColonyTree } from "./tree/ColonyTree";
import { NodeInspector } from "./inspector/NodeInspector";
import { ActivityFeed } from "./feed/ActivityFeed";

export function App() {
  const sessions = useSessions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const session = useSession(activeId);
  return (
    <div data-testid="app-shell" className="h-screen grid" style={{ gridTemplateColumns: "240px 1fr 360px" }}>
      <Sidebar sessions={sessions} activeId={activeId} onSelect={(id) => { setActiveId(id); setSelectedAgent(null); }} />
      <main className="relative" data-agent-count={session.agents.size}>
        {activeId && <ColonyTree agents={session.agents} onSelect={setSelectedAgent} selectedId={selectedAgent} />}
      </main>
      {selectedAgent
        ? <NodeInspector state={session} agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
        : <ActivityFeed state={session} />}
    </div>
  );
}

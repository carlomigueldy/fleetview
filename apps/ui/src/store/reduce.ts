import type { AgentStatus, SessionEvent } from "@fleetview/protocol";

export type AgentNode = {
  agentId: string; parentAgentId: string | null; label: string;
  status: AgentStatus; tokens: number; tools: number;
};
export type SessionState = { agents: Map<string, AgentNode>; events: SessionEvent[]; lastSeq: number };

export function emptyState(): SessionState {
  return {
    agents: new Map([["main", { agentId: "main", parentAgentId: null, label: "main", status: "working", tokens: 0, tools: 0 }]]),
    events: [], lastSeq: -1,
  };
}

function ensure(agents: Map<string, AgentNode>, id: string, parent: string | null): AgentNode {
  let n = agents.get(id);
  if (!n) { n = { agentId: id, parentAgentId: parent, label: id, status: "working", tokens: 0, tools: 0 }; agents.set(id, n); }
  return n;
}

export function reduce(state: SessionState, ev: SessionEvent): SessionState {
  const agents = new Map(state.agents);
  switch (ev.kind) {
    case "subagent_spawn": {
      agents.set(ev.agentId, { agentId: ev.agentId, parentAgentId: ev.parentAgentId, label: ev.label, status: "working", tokens: 0, tools: 0 });
      break;
    }
    case "subagent_exit": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, status: ev.status });
      break;
    }
    case "tool_call": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, tools: n.tools + 1 });
      break;
    }
    case "token_usage": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, tokens: n.tokens + ev.inTokens + ev.outTokens });
      break;
    }
    case "session_status": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, status: ev.status });
      break;
    }
  }
  return { agents, events: [...state.events, ev], lastSeq: Math.max(state.lastSeq, ev.seq) };
}

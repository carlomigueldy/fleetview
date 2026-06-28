import type { AgentStatus, SessionEvent } from "@fleetview/protocol";

export type AgentNode = {
  agentId: string; parentAgentId: string | null; label: string;
  status: AgentStatus; tokens: number; tools: number; model?: string;
};
export type SessionState = { agents: Map<string, AgentNode>; events: SessionEvent[]; lastSeq: number };

export function emptyState(): SessionState {
  return {
    agents: new Map([["main", { agentId: "main", parentAgentId: null, label: "main", status: "working", tokens: 0, tools: 0 }]]),
    events: [], lastSeq: -1,
  };
}

// Produce a short human-readable label from a raw agentId.
// Subagent IDs are long hex strings (e.g. "a25c755c15b3975c0") that crowd the
// colony canvas; slice to 7 chars so they read like Git short-hashes ("a25c755")
// instead of overwhelming the clean atelier aesthetic of the approved mockups.
// Exported so the activity feed can apply the same truncation to actor labels.
export function labelFor(id: string): string {
  return /^[0-9a-f]{8,}$/i.test(id) ? id.slice(0, 7) : id;
}

// Real sidechain agent IDs are long pure-hex strings (≥16 chars, e.g. "a25c755c15b3975c0").
// Spawn-placeholder IDs (from tool_use) look like "toolu_01…" or short test IDs —
// they always fail this test because they either contain non-hex chars or are too short.
function isRealSidechainId(id: string): boolean {
  return /^[0-9a-f]{16,}$/i.test(id);
}

function ensure(agents: Map<string, AgentNode>, id: string, parent: string | null): AgentNode {
  let n = agents.get(id);
  if (!n) {
    let label = labelFor(id);
    // Track the best parentAgentId we can infer.  When a spawn placeholder is found, its
    // parentAgentId (set by normalize to the spawning agent's real ID) supersedes the
    // incoming `parent` argument which may carry a stale "main" default from sidechain
    // files processed before the cross-file spawner mapping is resolved.
    let reconciledParent: string | null = parent;

    // Reconcile: when a real sidechain agent (long hex id) first appears, look for an
    // unmatched spawn-placeholder node under the same parent and steal its semantic label
    // (e.g. "explore", "plan", "tdd-impl").  This collapses the duplicate nodes that
    // would otherwise appear — one from the spawn tool_use event, one from the real
    // sidechain agent file — into a single colony node with a readable role name.
    // Step 1: exact parent match (reliable when spawner is known).
    // Step 2: any available placeholder (handles deep-nested agents whose sidechain events
    //   still carry parentAgentId:"main" due to the cross-file architecture limit).
    if (isRealSidechainId(id) && parent !== null) {
      // Step 1: try matching by parent (most precise).
      for (const [spawnId, spawnNode] of agents) {
        if (
          spawnNode.parentAgentId === parent &&
          spawnId !== "main" &&
          !isRealSidechainId(spawnId)
        ) {
          label = spawnNode.label;
          reconciledParent = spawnNode.parentAgentId; // inherit correct depth from spawn
          agents.delete(spawnId); // remove the spawn placeholder
          break;
        }
      }
      // Step 2: if still a raw hex hash, fall back to any available placeholder so
      // deep-nested agents don't get bare ordinal labels when their parentAgentId
      // couldn't be resolved cross-file.  We also adopt the spawn's parentAgentId so
      // the colony renders the correct depth rather than collapsing everything to depth 1.
      if (/^[0-9a-f]{7}$/i.test(label)) {
        for (const [spawnId, spawnNode] of agents) {
          if (spawnId !== "main" && !isRealSidechainId(spawnId)) {
            label = spawnNode.label;
            reconciledParent = spawnNode.parentAgentId; // deeper parent from spawn event
            agents.delete(spawnId);
            break;
          }
        }
      }
    }
    // If no semantic spawn label was found, the label remains the 7-char short hash
    // from labelFor() (e.g. "a80390a").  This keeps every node uniquely identifiable
    // on the colony canvas.  The previous "agent N" ordinal approach collapsed all
    // nodes sharing in-map parents to "agent 1" because per-parent sibling counts
    // were always 0 (each real parent has exactly one child in normalised session data).
    n = { agentId: id, parentAgentId: reconciledParent, label, status: "working", tokens: 0, tools: 0 };
    agents.set(id, n);
  }
  return n;
}

export function reduce(state: SessionState, ev: SessionEvent): SessionState {
  const agents = new Map(state.agents);
  switch (ev.kind) {
    case "subagent_spawn": {
      // Disambiguate label if a sibling under the same parent already carries it.
      // Two Task spawns of the same subagent_type (e.g. both labelled "Workflow")
      // would otherwise render as indistinguishable nodes on the colony canvas.
      let spawnLabel = ev.label;
      let ordinal = 2;
      const siblings = [...agents.values()].filter((n) => n.parentAgentId === ev.parentAgentId);
      while (siblings.some((n) => n.label === spawnLabel)) {
        spawnLabel = `${ev.label} ${ordinal++}`;
      }
      agents.set(ev.agentId, { agentId: ev.agentId, parentAgentId: ev.parentAgentId, label: spawnLabel, status: "working", tokens: 0, tools: 0 });
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
      const n = ensure(agents, ev.agentId, ev.parentAgentId);
      agents.set(ev.agentId, {
        ...n,
        tokens: n.tokens + ev.inTokens + ev.outTokens,
        // Prefer the most recent model string; once set, keep it if a later
        // token_usage event doesn't carry one (older transcript format).
        ...(ev.model ? { model: ev.model } : {}),
      });
      break;
    }
    case "session_status": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, status: ev.status });
      break;
    }
  }
  // Do NOT append ev to events here — the caller (useSession) batches a whole
  // message's worth of events and appends them in one splice, avoiding O(K²)
  // array copying when replaying a large backlog on session selection.
  return { agents, events: state.events, lastSeq: Math.max(state.lastSeq, ev.seq) };
}

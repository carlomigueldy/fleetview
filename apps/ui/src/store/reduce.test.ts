import { reduce, emptyState } from "./reduce";
import type { SessionEvent } from "@fleetview/protocol";

// Bridge-side definition of a "real sidechain agent" — must stay in sync with
// event-log.ts so the sidebar agentCount badge matches the colony node count.
const isRealSidechainId = (id: string) => /^[0-9a-f]{16,}$/i.test(id);

// Helper: compute agentCount the same way the bridge does after the Issue 1 fix.
// Counts "main" + real sidechain IDs (≥16 hex chars); excludes spawn placeholders.
function bridgeAgentCount(events: SessionEvent[]): number {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.agentId === "main" || isRealSidechainId(e.agentId)) seen.add(e.agentId);
  }
  return seen.size || 1;
}

const e = (p: Partial<SessionEvent> & Pick<SessionEvent, "kind">): SessionEvent =>
  ({ sessionId: "s1", agentId: "main", parentAgentId: null, seq: 0, ts: 0, ...(p as any) });

test("subagent_spawn adds a child agent node", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "subagent_spawn", agentId: "a2", parentAgentId: "main", label: "explore", seq: 1 } as any));
  expect(s.agents.get("a2")).toMatchObject({ label: "explore", parentAgentId: "main", status: "working" });
});

test("tool_call increments the agent tool count", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "subagent_spawn", agentId: "a2", parentAgentId: "main", label: "x", seq: 1 } as any));
  s = reduce(s, e({ kind: "tool_call", agentId: "a2", parentAgentId: "main", callId: "c1", tool: "Read", target: "/a", seq: 2 } as any));
  expect(s.agents.get("a2")!.tools).toBe(1);
});

test("subagent_exit sets status done and tracks lastSeq", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "subagent_spawn", agentId: "a2", parentAgentId: "main", label: "x", seq: 1 } as any));
  s = reduce(s, e({ kind: "subagent_exit", agentId: "a2", parentAgentId: "main", status: "done", seq: 3 } as any));
  expect(s.agents.get("a2")!.status).toBe("done");
  expect(s.lastSeq).toBe(3);
});

// ── Cross-layer consistency: bridge agentCount must equal UI agents.size ─────
//
// The bridge EventLog.agentCount and the UI reduce() agents Map must agree on
// how many distinct agents a session has so the Sidebar badge matches the colony
// node count.  Both now use the same definition:
//   "main" + real sidechain IDs (pure hex, ≥16 chars)
// Spawn-placeholder IDs (e.g. "toolu_01…") are excluded from both counts; the
// UI reconciles them into the real sidechain node via isRealSidechainId().

test("agents.size matches bridge agentCount for a spawn+sidechain fixture (cross-layer consistency)", () => {
  const SPAWN_ID = "toolu_01abc123";          // tool_use spawn placeholder — non-hex
  const HEX_ID  = "a25c755c15b3975c0";        // 17-char hex — real sidechain agent

  // reduce() only calls ensure() for tool_call/token_usage/subagent_exit/session_status;
  // message events are not node-creating.  Use token_usage to trigger sidechain node creation,
  // mirroring what normalize.ts emits for every assistant turn that carries usage metadata.
  const fixture: SessionEvent[] = [
    { sessionId: "s1", agentId: "main",    parentAgentId: null,   seq: 0, ts: 0, kind: "token_usage", inTokens: 100, outTokens: 50 },
    { sessionId: "s1", agentId: SPAWN_ID,  parentAgentId: "main", seq: 1, ts: 1, kind: "subagent_spawn", label: "explore" },
    { sessionId: "s1", agentId: HEX_ID,   parentAgentId: "main", seq: 2, ts: 2, kind: "token_usage", inTokens: 200, outTokens: 80 },
  ];

  // UI reduce path
  let s = emptyState();
  for (const ev of fixture) s = reduce(s, ev);
  // Spawn placeholder is reconciled: its node is deleted and HEX_ID node takes its label.
  // Final agents: "main" + HEX_ID → size = 2.
  expect(s.agents.size).toBe(2);
  expect(s.agents.has("main")).toBe(true);
  expect(s.agents.has(HEX_ID)).toBe(true);
  expect(s.agents.has(SPAWN_ID)).toBe(false); // placeholder was collapsed

  // Bridge count path (mirrors EventLog.agentCount after the Issue 1 fix)
  const bridge = bridgeAgentCount(fixture);
  expect(bridge).toBe(2);

  // The two counts must agree — this is the invariant the badge depends on.
  expect(s.agents.size).toBe(bridge);
});

test("labels are distinct for real-hex agents whose parents are also in the map", () => {
  // Reproduces the real-data scenario where 249/249 sidechain agents have
  // parentInMap === true and each parent has exactly one child.  The previous
  // "agent N" ordinal logic collapsed all such agents to "agent 1" because the
  // per-parent sibling count was always 0.  After the fix, each node keeps its
  // distinct 7-char short-hash label from labelFor().
  const HEX1 = "a1b2c3d4e5f60001a"; // parent: main
  const HEX2 = "b2c3d4e5f6700002b"; // parent: HEX1
  const HEX3 = "c3d4e5f678000003c"; // parent: HEX2
  const HEX4 = "d4e5f68900000004d"; // parent: HEX3

  const fixture: SessionEvent[] = [
    { sessionId: "s1", agentId: "main", parentAgentId: null, seq: 0, ts: 0, kind: "token_usage", inTokens: 10, outTokens: 5 },
    { sessionId: "s1", agentId: HEX1, parentAgentId: "main", seq: 1, ts: 1, kind: "token_usage", inTokens: 10, outTokens: 5 },
    { sessionId: "s1", agentId: HEX2, parentAgentId: HEX1,  seq: 2, ts: 2, kind: "token_usage", inTokens: 10, outTokens: 5 },
    { sessionId: "s1", agentId: HEX3, parentAgentId: HEX2,  seq: 3, ts: 3, kind: "token_usage", inTokens: 10, outTokens: 5 },
    { sessionId: "s1", agentId: HEX4, parentAgentId: HEX3,  seq: 4, ts: 4, kind: "token_usage", inTokens: 10, outTokens: 5 },
  ];

  let s = emptyState();
  for (const ev of fixture) s = reduce(s, ev);

  // All 4 sidechain agents should be in the map (plus main).
  expect(s.agents.size).toBe(5);

  // Every label should be the 7-char short hash of its agentId — each is unique.
  for (const id of [HEX1, HEX2, HEX3, HEX4]) {
    expect(s.agents.get(id)!.label).toBe(id.slice(0, 7));
  }
  // Confirm all four labels are distinct (no collapse to "agent 1").
  const labels = [HEX1, HEX2, HEX3, HEX4].map((id) => s.agents.get(id)!.label);
  expect(new Set(labels).size).toBe(4);
});

test("agents.size matches bridge agentCount with two sidechain agents", () => {
  const HEX1 = "a1b2c3d4e5f60001a"; // 17-char hex
  const HEX2 = "b2c3d4e5f6700002b"; // 17-char hex

  const fixture: SessionEvent[] = [
    { sessionId: "s1", agentId: "main",    parentAgentId: null,   seq: 0, ts: 0, kind: "token_usage", inTokens: 100, outTokens: 50 },
    { sessionId: "s1", agentId: "toolu_01", parentAgentId: "main", seq: 1, ts: 1, kind: "subagent_spawn", label: "explore" },
    { sessionId: "s1", agentId: "toolu_02", parentAgentId: "main", seq: 2, ts: 2, kind: "subagent_spawn", label: "implement" },
    { sessionId: "s1", agentId: HEX1,      parentAgentId: "main", seq: 3, ts: 3, kind: "token_usage", inTokens: 200, outTokens: 80 },
    { sessionId: "s1", agentId: HEX2,      parentAgentId: "main", seq: 4, ts: 4, kind: "token_usage", inTokens: 150, outTokens: 60 },
  ];

  let s = emptyState();
  for (const ev of fixture) s = reduce(s, ev);
  // Two placeholders reconciled with two real sidechain agents → main + HEX1 + HEX2 = 3
  expect(s.agents.size).toBe(3);

  const bridge = bridgeAgentCount(fixture);
  expect(bridge).toBe(3);
  expect(s.agents.size).toBe(bridge);
});

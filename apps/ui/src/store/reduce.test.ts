import { reduce, emptyState } from "./reduce";
import type { SessionEvent } from "@fleetview/protocol";

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

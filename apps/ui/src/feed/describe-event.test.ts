import { describeEvent } from "./describe-event";
import type { SessionEvent } from "@fleetview/protocol";
const e = (p: any): SessionEvent => ({ sessionId: "s1", agentId: "a2", parentAgentId: "main", seq: 0, ts: 0, ...p });

test("describes a subagent spawn", () => {
  expect(describeEvent(e({ kind: "subagent_spawn", label: "explore" }))).toEqual({ actor: "a2", text: "spawned subagent", detail: "explore" });
});
test("describes a tool call", () => {
  expect(describeEvent(e({ kind: "tool_call", tool: "Read", target: "/a.ts", callId: "c" }))).toEqual({ actor: "a2", text: "Read", detail: "/a.ts" });
});
test("returns null for token_usage (not feed-worthy)", () => {
  expect(describeEvent(e({ kind: "token_usage", inTokens: 1, outTokens: 2 }))).toBeNull();
});

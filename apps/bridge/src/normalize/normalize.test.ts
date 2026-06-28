import { expect, test } from "bun:test";
import { normalize } from "./normalize";
import type { RawEntry } from "../transcript/read";

const mk = (p: Partial<RawEntry>): RawEntry => ({
  uuid: "u", parentUuid: null, type: "assistant", sessionId: "s1",
  cwd: "/p", ts: 1, isSidechain: false, agentId: null, attributionAgent: null, message: null, ...p,
});

test("text assistant message becomes a message event on main", () => {
  const evs = normalize([mk({ uuid: "u1", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } })]);
  expect(evs).toHaveLength(1);
  expect(evs[0]).toMatchObject({ kind: "message", role: "assistant", text: "hello", agentId: "main", parentAgentId: null, seq: 0 });
});

test("Agent tool_use becomes subagent_spawn", () => {
  const evs = normalize([mk({ uuid: "u2", message: { role: "assistant", content: [
    { type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "Explore", description: "find auth" } },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "subagent_spawn", label: "find auth", agentId: "t1", parentAgentId: "main" });
});

test("Workflow tool_use becomes subagent_spawn", () => {
  const evs = normalize([mk({ uuid: "u2b", message: { role: "assistant", content: [
    { type: "tool_use", id: "wf1", name: "Workflow", input: { scriptPath: "/tmp/ui-ux-workflow.js" } },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "subagent_spawn", agentId: "wf1", parentAgentId: "main" });
});

test("non-spawn tool_use becomes tool_call with target", () => {
  const evs = normalize([mk({ uuid: "u3", message: { role: "assistant", content: [
    { type: "tool_use", id: "c1", name: "Read", input: { file_path: "/p/a.ts" } },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "tool_call", callId: "c1", tool: "Read", target: "/p/a.ts" });
});

test("tool_result becomes tool_result event", () => {
  const evs = normalize([mk({ type: "user", uuid: "u4", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "c1", is_error: false, content: "ok done" },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "tool_result", callId: "c1", ok: true });
});

test("seq increments across events", () => {
  const evs = normalize([
    mk({ uuid: "u1", message: { role: "assistant", content: [{ type: "text", text: "a" }] } }),
    mk({ uuid: "u2", message: { role: "assistant", content: [{ type: "text", text: "b" }] } }),
  ]);
  expect(evs.map((e) => e.seq)).toEqual([0, 1]);
});

import { readEntries } from "../transcript/read";

test("normalizes the captured subagent fixture without throwing", async () => {
  const file = new URL("../../../../packages/protocol/fixtures/subagent-session.jsonl", import.meta.url).pathname;
  const evs = normalize(await readEntries(file));
  expect(evs.length).toBeGreaterThan(0);
  expect(evs.some((e) => e.kind === "subagent_spawn")).toBe(true);
});

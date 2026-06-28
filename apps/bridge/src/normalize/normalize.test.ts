import { expect, test } from "bun:test";
import { normalize } from "./normalize";
import type { RawEntry } from "../transcript/read";

const mk = (p: Partial<RawEntry>): RawEntry => ({
  uuid: "u", parentUuid: null, type: "assistant", sessionId: "s1",
  cwd: "/p", ts: 1, isSidechain: false, agentId: null, attributionAgent: null, gitBranch: null, message: null, ...p,
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

test("null-message entries do not throw and produce no output events", () => {
  // Real transcripts contain summary/meta lines where message===null.
  // The normalizer must skip them cleanly rather than crashing on msg.role.
  const evs = normalize([mk({ uuid: "x" })]);
  expect(evs).toEqual([]);
});

// ── Token attribution tests ────────────────────────────────────────────────────

test("main agent accrues tokens when usage is present (non-cache)", () => {
  // Basic input_tokens + output_tokens path.
  const evs = normalize([mk({ uuid: "u-tok", message: {
    role: "assistant",
    usage: { input_tokens: 100, output_tokens: 40 },
    content: [{ type: "text", text: "response" }],
  } })]);
  const tok = evs.find((e) => e.kind === "token_usage");
  expect(tok).toBeDefined();
  expect(tok).toMatchObject({ kind: "token_usage", agentId: "main", inTokens: 100, outTokens: 40 });
});

test("main agent accrues tokens including cache_read and cache_creation fields", () => {
  // Claude API returns cache_read_input_tokens / cache_creation_input_tokens alongside
  // input_tokens when the prompt is partially served from cache.  All three fields must
  // be summed into inTokens so the inspector shows real consumption rather than 0.
  const evs = normalize([mk({ uuid: "u-cache", message: {
    role: "assistant",
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 200,
      output_tokens: 50,
    },
    content: [{ type: "text", text: "cached response" }],
  } })]);
  const tok = evs.find((e) => e.kind === "token_usage");
  expect(tok).toBeDefined();
  // 10 + 800 + 200 = 1010 total input tokens
  expect(tok).toMatchObject({ kind: "token_usage", agentId: "main", inTokens: 1010, outTokens: 50 });
});

test("token_usage event is emitted before text message events in the same turn", () => {
  // The usage block is emitted first (before content blocks) so reduce.ts can
  // update the token counter before any associated message events are processed.
  const evs = normalize([mk({ uuid: "u-order", message: {
    role: "assistant",
    usage: { input_tokens: 5, output_tokens: 3 },
    content: [{ type: "text", text: "hello" }],
  } })]);
  expect(evs[0].kind).toBe("token_usage");
  expect(evs[1].kind).toBe("message");
});

// ── Permission-gate / waiting-status tests ────────────────────────────────────

test("emits session_status:waiting when a tool_use has no matching tool_result", () => {
  const evs = normalize([
    mk({ uuid: "u5", message: { role: "assistant", content: [
      { type: "tool_use", id: "gate1", name: "Read", input: { file_path: "/secret.ts" } },
    ] } }),
  ]);
  // Should have: 1 tool_call + 1 session_status(waiting)
  expect(evs).toHaveLength(2);
  expect(evs[1]).toMatchObject({ kind: "session_status", status: "waiting", agentId: "main" });
});

test("does NOT emit session_status when all tool_uses have matching tool_results", () => {
  // Normalizer only emits session_status:'waiting' for genuinely pending calls.
  // When all tool_uses have resolved, no session_status is emitted — the mtime
  // heuristic in EventLog.sessions() already yields 'working' for recently-modified
  // sessions, so emitting an explicit 'working' would only create a sticky latch
  // that EventLog can't clear once the session goes stale (> 2 min).
  const evs = normalize([
    mk({ uuid: "u6", message: { role: "assistant", content: [
      { type: "tool_use", id: "done1", name: "Read", input: { file_path: "/ok.ts" } },
    ] } }),
    mk({ type: "user", uuid: "u7", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "done1", is_error: false, content: "file contents" },
    ] } }),
  ]);
  // No session_status of any kind when all calls are resolved.
  expect(evs.some((e) => e.kind === "session_status")).toBe(false);
  // Only the tool_call and tool_result events are present.
  expect(evs).toHaveLength(2);
  expect(evs[0]).toMatchObject({ kind: "tool_call", callId: "done1" });
  expect(evs[1]).toMatchObject({ kind: "tool_result", callId: "done1" });
});

test("emits session_status:waiting on sidechain agentId when sidechain tool_use is pending", () => {
  const sidechainEntry: RawEntry = {
    uuid: "s1", parentUuid: null, type: "assistant", sessionId: "sess1",
    cwd: "/p", ts: 5, isSidechain: true, agentId: "a25c755c15b3975c0",
    attributionAgent: null, gitBranch: null, message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "sc-gate", name: "Bash", input: { command: "npm test" } }],
    },
  };
  const evs = normalize([sidechainEntry]);
  const statusEv = evs.find((e) => e.kind === "session_status");
  expect(statusEv).toBeDefined();
  expect(statusEv).toMatchObject({ status: "waiting", agentId: "a25c755c15b3975c0" });
});

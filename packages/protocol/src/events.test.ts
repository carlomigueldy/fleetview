import { expect, test } from "vitest";
import { parseSessionEvent, type SessionEvent } from "./events";

const base = { sessionId: "s1", agentId: "a1", parentAgentId: null, seq: 0, ts: 1000 };

test("parses a valid message event", () => {
  const e: SessionEvent = { ...base, kind: "message", role: "assistant", text: "hi" };
  expect(parseSessionEvent(e)).toEqual(e);
});

test("parses a subagent_spawn with a parent", () => {
  const e: SessionEvent = { ...base, agentId: "a2", parentAgentId: "a1", kind: "subagent_spawn", label: "explore" };
  expect(parseSessionEvent(e)).toEqual(e);
});

test("rejects an unknown kind", () => {
  expect(() => parseSessionEvent({ ...base, kind: "nope" })).toThrow();
});

test("rejects a message missing required base fields", () => {
  expect(() => parseSessionEvent({ kind: "message", role: "user", text: "x" })).toThrow();
});

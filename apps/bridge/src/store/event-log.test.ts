import { expect, test } from "bun:test";
import { EventLog } from "./event-log";
import type { SessionEvent } from "@fleetview/protocol";

const ev = (seq: number, sessionId = "s1"): SessionEvent => ({
  sessionId, agentId: "main", parentAgentId: null, seq, ts: seq, kind: "message", role: "assistant", text: "x",
});

test("append then read back since a seq", () => {
  const log = new EventLog();
  log.append([ev(0), ev(1), ev(2)]);
  expect(log.since("s1", -1)).toHaveLength(3);
  expect(log.since("s1", 0).map((e) => e.seq)).toEqual([1, 2]);
});

test("lists distinct sessions", () => {
  const log = new EventLog();
  log.append([ev(0, "s1"), ev(0, "s2")]);
  expect(log.sessions().sort()).toEqual(["s1", "s2"]);
});

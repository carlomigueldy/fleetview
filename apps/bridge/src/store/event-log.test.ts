import { expect, test } from "bun:test";
import { EventLog } from "./event-log";
import type { SessionEvent } from "@fleetview/protocol";

const ev = (seq: number, sessionId = "s1"): SessionEvent => ({
  sessionId, agentId: "main", parentAgentId: null, seq, ts: seq, kind: "message", role: "assistant", text: "x",
});

// Helper to build a subagent_spawn event (uses a tool_use-id as agentId, the
// temporary spawn-placeholder that normalize.ts assigns for Agent/Workflow calls).
const spawnEv = (seq: number, spawnId: string, sessionId = "s1"): SessionEvent => ({
  sessionId, agentId: spawnId, parentAgentId: "main", seq, ts: seq, kind: "subagent_spawn", label: "explore",
});

// Helper to build an event from the REAL sidechain agent (hex id from agent-*.jsonl).
const sidechainEv = (seq: number, hexId: string, sessionId = "s1"): SessionEvent => ({
  sessionId, agentId: hexId, parentAgentId: "main", seq, ts: seq, kind: "message", role: "assistant", text: "sidechain",
});

test("append then read back since a seq", () => {
  const log = new EventLog();
  log.append([ev(0), ev(1), ev(2)]);
  expect(log.since("s1", -1)).toHaveLength(3);
  expect(log.since("s1", 0).map((e) => e.seq)).toEqual([1, 2]);
});

test("sessions() returns SessionMeta objects for distinct sessions", () => {
  const log = new EventLog();
  log.append([ev(0, "s1"), ev(0, "s2")]);
  log.setMeta("s1", "/home/user/myproject", 1000);
  log.setMeta("s2", "/home/user/otherapp", 2000);
  const result = log.sessions().sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ sessionId: "s1", cwd: "/home/user/myproject", label: "myproject", mtimeMs: 1000 });
  expect(result[1]).toMatchObject({ sessionId: "s2", cwd: "/home/user/otherapp", label: "otherapp", mtimeMs: 2000 });
});

test("setMeta upserts — second call overwrites cwd and mtimeMs", () => {
  const log = new EventLog();
  log.append([ev(0, "s1")]);
  log.setMeta("s1", "/old/path", 100);
  log.setMeta("s1", "/new/path", 200);
  const [meta] = log.sessions();
  expect(meta.cwd).toBe("/new/path");
  expect(meta.label).toBe("path");
  expect(meta.mtimeMs).toBe(200);
});

test("sessions() without setMeta falls back to UUID prefix for label and zero mtimeMs", () => {
  const log = new EventLog();
  const sessionId = "abcdef12-0000-0000-0000-000000000000";
  log.append([ev(0, sessionId)]);
  const [meta] = log.sessions();
  expect(meta.sessionId).toBe(sessionId);
  expect(meta.cwd).toBe("");
  expect(meta.label).toBe(sessionId.slice(0, 8));
  expect(meta.mtimeMs).toBe(0);
});

// ── agentCount double-counting tests ─────────────────────────────────────────

test("agentCount counts main-only session as 1", () => {
  const log = new EventLog();
  log.append([ev(0), ev(1)]);
  const [meta] = log.sessions();
  expect(meta.agentCount).toBe(1);
});

test("agentCount does NOT double-count spawn placeholder and real sidechain agent (multi-file fixture)", () => {
  // Simulates what normalize.ts produces for a session with one spawned subagent:
  //   main emits: message + subagent_spawn(spawnId) + tool_call
  //   sidechain file emits: message(hexId) + tool_call(hexId)
  //
  // Without the fix, agentCount would be 3 (main + spawnId + hexId) even though
  // there are only 2 logical agents.  With the fix, spawn events are excluded from
  // the count, giving 2 (main + hexId).
  const log = new EventLog();
  const SPAWN_ID = "toolu_01abc";       // tool_use id used by normalize for spawn event
  const HEX_ID   = "a25c755c15b3975c0"; // real agent id from agent-<id>.jsonl

  log.append([
    ev(0),                               // main: message
    spawnEv(1, SPAWN_ID),               // main: spawns subagent (placeholder id)
    sidechainEv(2, HEX_ID),             // sidechain agent's own events
  ]);

  const [meta] = log.sessions();
  // Logical agents: "main" + one sidechain agent (hexId).  The spawn placeholder
  // must NOT be counted as a third agent.
  expect(meta.agentCount).toBe(2);
});

test("agentCount with two sidechain agents counts correctly", () => {
  const log = new EventLog();
  // Use ≥16-char pure-hex IDs — the same format that real agent-<id>.jsonl filenames use.
  // Short test IDs like "hex111" are 6 chars and would be excluded by isRealSidechainId().
  log.append([
    ev(0),
    spawnEv(1, "toolu_01"),
    spawnEv(2, "toolu_02"),
    sidechainEv(3, "a1b2c3d4e5f60001a"), // 17-char hex
    sidechainEv(4, "b2c3d4e5f6700002b"), // 17-char hex
  ]);
  const [meta] = log.sessions();
  expect(meta.agentCount).toBe(3); // main + a1b2c3... + b2c3d4...
});

// ── lastStatus / waiting pip tests ───────────────────────────────────────────

test("sessions() returns waiting status when a recent session_status:waiting event is appended", () => {
  const log = new EventLog();
  // Must be within the 2-min recency gate for 'waiting' to be honoured.
  const recentTs = Date.now() - 30_000; // 30 seconds ago
  const statusEv: SessionEvent = {
    sessionId: "s1", agentId: "main", parentAgentId: null,
    seq: 1, ts: recentTs,
    kind: "session_status", status: "waiting",
  };
  log.append([ev(0), statusEv]);
  log.setMeta("s1", "/some/project", recentTs);
  const [meta] = log.sessions();
  expect(meta.status).toBe("waiting");
});

test("sessions() honours waiting even when the session is older than 2 min (persistent attention state)", () => {
  // 'waiting' is decoupled from the recency gate — the latch self-clears via progress
  // events (see EventLog.append) so it cannot become stale while the agent progresses.
  // A user who has been away >2 min needs to see the clay pip most of all.
  const log = new EventLog();
  const staleTs = Date.now() - 5 * 60_000; // 5 min ago — outside the 2-min recency gate
  const statusEv: SessionEvent = {
    sessionId: "s1", agentId: "main", parentAgentId: null,
    seq: 1, ts: staleTs,
    kind: "session_status", status: "waiting",
  };
  log.append([ev(0), statusEv]);
  log.setMeta("s1", "/some/project", staleTs);
  const [meta] = log.sessions();
  // 'waiting' must always be honoured regardless of mtime age.
  expect(meta.status).toBe("waiting");
});

test("sessions() falls back to idle when an explicit working event is stale (working-latch regression)", () => {
  // Root cause of bug: explicit='working' + stale mtime used to bypass the recency
  // gate, permanently showing a sea of false-green pips for completed sessions.
  const log = new EventLog();
  const staleTs = Date.now() - 5 * 60_000; // 5 min ago — well outside the 2-min gate
  const statusEv: SessionEvent = {
    sessionId: "s1", agentId: "main", parentAgentId: null,
    seq: 1, ts: staleTs,
    kind: "session_status", status: "working",
  };
  log.append([ev(0), statusEv]);
  log.setMeta("s1", "/some/project", staleTs);
  const [meta] = log.sessions();
  // Stale mtime (5 min) — explicit 'working' must NOT bypass the recency gate.
  expect(meta.status).toBe("idle");
});

test("sessions() clears waiting when a later progress event arrives (regression)", () => {
  // Regression: the production normalizer never emits session_status:'working', so
  // the latch must be cleared by the real path: a progress event (message / tool_call /
  // tool_result / token_usage) with a higher seq than the waiting event.
  const log = new EventLog();
  const recentTs = Date.now() - 30_000;
  const waitEv: SessionEvent = {
    sessionId: "s1", agentId: "main", parentAgentId: null,
    seq: 1, ts: recentTs, kind: "session_status", status: "waiting",
  };
  log.append([ev(0), waitEv]);
  log.setMeta("s1", "/some/project", recentTs);
  expect(log.sessions()[0].status).toBe("waiting"); // sanity-check: latch is set

  // A progress event with a higher seq means the agent continued working — latch clears.
  const progressEv: SessionEvent = {
    sessionId: "s1", agentId: "main", parentAgentId: null,
    seq: 2, ts: Date.now(), kind: "message", role: "assistant", text: "still going",
  };
  log.append([progressEv]);
  log.setMeta("s1", "/some/project", Date.now());
  // latch cleared — mtime heuristic takes over, session is within 2-min window → 'working'
  expect(log.sessions()[0].status).toBe("working");
});

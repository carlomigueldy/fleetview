import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionWatcher } from "./session-watcher";
import { EventLog } from "../store/event-log";

const line = (uuid: string, text: string) =>
  JSON.stringify({ uuid, parentUuid: null, type: "assistant", sessionId: "sess-x", cwd: "/p",
    timestamp: "2026-06-28T10:00:00.000Z", isSidechain: false, message: { role: "assistant", content: [{ type: "text", text }] } });

test("scanOnce emits only newly appended events on each call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fv-"));
  const file = join(dir, "sess.jsonl");
  await writeFile(file, line("u1", "first") + "\n");
  const log = new EventLog();
  const w = new SessionWatcher(dir, log);

  const first = await w.scanOnce();
  expect(first.map((e) => (e as any).text)).toContain("first");

  await writeFile(file, line("u1", "first") + "\n" + line("u2", "second") + "\n");
  const second = await w.scanOnce();
  expect(second.map((e) => (e as any).text)).toEqual(["second"]);
});

// ── Multi-file session regression ──────────────────────────────────────────────
// A Claude session is split across a main <sid>.jsonl plus separate
// subagents/agent-*.jsonl files that all carry the same sessionId.
// Before the fix, normalize() restarted seq at 0 per file and the per-session
// highestSeq filter silently dropped all events from files after the first.
// This test verifies that both main and sidechain agent events survive into the log.

test("scanOnce ingests both main and sidechain files sharing the same sessionId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fv-multi-"));

  const mainLine = JSON.stringify({
    uuid: "m1", parentUuid: null, type: "assistant", sessionId: "sess-multi",
    cwd: "/proj", timestamp: "2026-06-28T10:00:00.000Z", isSidechain: false,
    message: { role: "assistant", content: [{ type: "text", text: "main message" }] },
  });
  const sidechainLine = JSON.stringify({
    uuid: "s1", parentUuid: null, type: "assistant", sessionId: "sess-multi",
    cwd: "/proj", timestamp: "2026-06-28T10:01:00.000Z",
    isSidechain: true, agentId: "deadbeef12345678",
    message: { role: "assistant", content: [{ type: "text", text: "sidechain message" }] },
  });

  // Main file at the root of the directory (mimics <sid>.jsonl layout).
  await writeFile(join(dir, "sess-multi.jsonl"), mainLine + "\n");
  // Sidechain file in a subagents/ subdir (mimics agent-<id>.jsonl layout).
  await mkdir(join(dir, "subagents"), { recursive: true });
  await writeFile(join(dir, "subagents", "agent-deadbeef12345678.jsonl"), sidechainLine + "\n");

  const log = new EventLog();
  const w = new SessionWatcher(dir, log);
  await w.scanOnce();

  const events = log.since("sess-multi", -1);
  const agentIds = new Set(events.map((e) => e.agentId));

  // Both the main agent and the sidechain agent must be present — neither should be
  // silently dropped by the per-file seq collision that this fix addresses.
  expect(agentIds.has("main")).toBe(true);
  expect(agentIds.has("deadbeef12345678")).toBe(true);
});

test("scanOnce persists cwd and mtimeMs via setMeta even when no new events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fv-meta-"));
  const file = join(dir, "sess.jsonl");
  // Write one entry so discoverSessions picks it up
  await writeFile(file, line("u1", "hello") + "\n");
  const log = new EventLog();
  const w = new SessionWatcher(dir, log);

  // First scan: populates events AND should call setMeta
  await w.scanOnce();

  // Second scan: no new events, but setMeta should still be called
  await w.scanOnce();

  // The session_meta table should have been populated (cwd = "/p" per the line helper)
  const sessions = log.sessions();
  expect(sessions).toHaveLength(1);
  expect(sessions[0].sessionId).toBe("sess-x");
  expect(sessions[0].cwd).toBe("/p");
  expect(sessions[0].label).toBe("p");
  expect(sessions[0].mtimeMs).toBeGreaterThan(0);
});

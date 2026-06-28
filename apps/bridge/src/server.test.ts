import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "./server";
import { EventLog } from "./store/event-log";
import { SessionWatcher } from "./watcher/session-watcher";
import type { SessionEvent } from "@fleetview/protocol";

const ev = (seq: number, sessionId = "s1"): SessionEvent => ({
  sessionId,
  agentId: "main",
  parentAgentId: null,
  seq,
  ts: seq,
  kind: "message",
  role: "assistant",
  text: "hi",
});

test("subscribe replays backlog over websocket", async () => {
  const log = new EventLog();
  log.append([ev(0), ev(1)]);
  const watcher = new SessionWatcher("/nonexistent-skip", log);
  const srv = createServer({ log, watcher, port: 0 });

  const got = await new Promise<SessionEvent[]>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", sessionId: "s1", afterSeq: -1 }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type === "events") { resolve(msg.events); ws.close(); }
    };
  });
  expect(got).toHaveLength(2);
  srv.stop();
});

test("list returns all session ids", async () => {
  const log = new EventLog();
  log.append([ev(0, "s1"), ev(0, "s2")]);
  const watcher = new SessionWatcher("/nonexistent-skip", log);
  const srv = createServer({ log, watcher, port: 0 });

  const sessions = await new Promise<string[]>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "list" }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type === "sessions") { resolve(msg.sessions); ws.close(); }
    };
  });
  expect(sessions).toContain("s1");
  expect(sessions).toContain("s2");
  srv.stop();
});

test("live events are streamed only to matching subscriber", async () => {
  const scratchDir = `/tmp/fleetview-test-live-${Date.now()}`;
  const projDir = join(scratchDir, "proj");
  mkdirSync(projDir, { recursive: true });

  // Write a JSONL transcript for session s1 only
  const entry = JSON.stringify({
    uuid: "u1",
    parentUuid: null,
    type: "assistant",
    sessionId: "s1",
    cwd: scratchDir,
    timestamp: new Date().toISOString(),
    isSidechain: false,
    message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
  });
  writeFileSync(join(projDir, "s1.jsonl"), entry + "\n");

  const log = new EventLog();
  const watcher = new SessionWatcher(scratchDir, log);
  const srv = createServer({ log, watcher, port: 0 });

  // Subscribe to s1, then trigger a scan; collect all messages
  const frames = await new Promise<any[]>((resolve) => {
    const received: any[] = [];
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    ws.onopen = async () => {
      ws.send(JSON.stringify({ type: "subscribe", sessionId: "s1", afterSeq: -1 }));
      // Wait for backlog (empty since log is empty at subscribe time), then scan
      await new Promise((r) => setTimeout(r, 30));
      await watcher.scanOnce();
      // Give WS a moment to receive the live frame
      await new Promise((r) => setTimeout(r, 50));
      resolve(received);
      ws.close();
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      received.push(msg);
    };
  });

  // Should have received at least one events frame with s1 events
  const eventFrames = frames.filter((f) => f.type === "events" && f.events.length > 0);
  expect(eventFrames.length).toBeGreaterThan(0);
  for (const frame of eventFrames) {
    for (const e of frame.events as SessionEvent[]) {
      expect(e.sessionId).toBe("s1");
    }
  }
  srv.stop();
});

import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "./server";
import { EventLog } from "./store/event-log";
import { SessionWatcher } from "./watcher/session-watcher";
import type { SessionEvent } from "@fleetview/protocol";
import type { SessionMeta } from "./ws-protocol";

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

test("list returns SessionMeta objects for all sessions", async () => {
  const log = new EventLog();
  log.append([ev(0, "s1"), ev(0, "s2")]);
  log.setMeta("s1", "/home/user/project-alpha", 1000);
  log.setMeta("s2", "/home/user/project-beta", 2000);
  const watcher = new SessionWatcher("/nonexistent-skip", log);
  const srv = createServer({ log, watcher, port: 0 });

  const sessions = await new Promise<SessionMeta[]>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "list" }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type === "sessions") { resolve(msg.sessions); ws.close(); }
    };
  });
  const ids = sessions.map((s) => s.sessionId);
  expect(ids).toContain("s1");
  expect(ids).toContain("s2");
  const s1 = sessions.find((s) => s.sessionId === "s1")!;
  expect(s1.cwd).toBe("/home/user/project-alpha");
  expect(s1.label).toBe("project-alpha");
  expect(s1.mtimeMs).toBe(1000);
  srv.stop();
});

test("binds to loopback only by default", () => {
  const log = new EventLog();
  const watcher = new SessionWatcher("/nonexistent-skip", log);
  const srv = createServer({ log, watcher, port: 0 });
  expect(srv.hostname).toBe("127.0.0.1");
  srv.stop();
});

test("rejects a cross-origin websocket handshake (CSWSH)", async () => {
  const log = new EventLog();
  const watcher = new SessionWatcher("/nonexistent-skip", log);
  const srv = createServer({ log, watcher, port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/ws`, {
    headers: { origin: "http://evil.example.com" },
  });
  expect(res.status).toBe(403);
  srv.stop();
});

test("allows an allow-listed origin past the origin check", async () => {
  const log = new EventLog();
  const watcher = new SessionWatcher("/nonexistent-skip", log);
  const srv = createServer({ log, watcher, port: 0, allowedOrigins: ["http://good.example.com"] });
  // A plain GET (no upgrade headers) with an allowed origin passes the origin
  // gate and reaches the upgrade attempt, which fails with 400 (not 403).
  const res = await fetch(`http://127.0.0.1:${srv.port}/ws`, {
    headers: { origin: "http://good.example.com" },
  });
  expect(res.status).toBe(400);
  srv.stop();
});

test("malformed websocket frame does not throw", async () => {
  const log = new EventLog();
  log.append([ev(0)]);
  const watcher = new SessionWatcher("/nonexistent-skip", log);
  const srv = createServer({ log, watcher, port: 0 });
  const stillAlive = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
    ws.onopen = () => {
      ws.send("this is not json{{{");
      ws.send(JSON.stringify({ type: "subscribe", sessionId: "s1", afterSeq: -1 }));
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type === "events") { resolve(true); ws.close(); }
    };
    setTimeout(() => resolve(false), 1000);
  });
  expect(stillAlive).toBe(true);
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

import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
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

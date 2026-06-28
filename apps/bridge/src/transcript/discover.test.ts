import { expect, test } from "bun:test";
import { discoverSessions } from "./discover";

const root = new URL("./__fixtures__/", import.meta.url).pathname;

test("discovers sessions from jsonl files under root", async () => {
  const sessions = await discoverSessions(root);
  const a = sessions.find((s) => s.sessionId === "sess-a");
  expect(a).toBeDefined();
  expect(a!.cwd).toBe("/home/me/proj");
  expect(a!.file.endsWith("a.jsonl")).toBe(true);
});

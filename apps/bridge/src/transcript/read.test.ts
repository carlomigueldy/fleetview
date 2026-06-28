import { expect, test } from "bun:test";
import { readEntries } from "./read";

const fixture = new URL("./__fixtures__/proj/a.jsonl", import.meta.url).pathname;

test("reads valid lines and skips malformed ones", async () => {
  const entries = await readEntries(fixture);
  expect(entries).toHaveLength(2);
  expect(entries[0].uuid).toBe("u1");
  expect(entries[0].ts).toBe(Date.parse("2026-06-28T10:00:00.000Z"));
  expect(entries[1].parentUuid).toBe("u1");
});

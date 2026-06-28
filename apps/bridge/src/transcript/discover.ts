import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readEntries } from "./read";

export type DiscoveredSession = { sessionId: string; file: string; cwd: string; mtimeMs: number };

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

export async function discoverSessions(root: string): Promise<DiscoveredSession[]> {
  const files = await walk(root);
  const sessions: DiscoveredSession[] = [];
  for (const file of files) {
    const entries = await readEntries(file);
    if (entries.length === 0) continue;
    const { sessionId, cwd } = entries[0];
    const { mtimeMs } = await stat(file);
    sessions.push({ sessionId, file, cwd, mtimeMs });
  }
  return sessions;
}

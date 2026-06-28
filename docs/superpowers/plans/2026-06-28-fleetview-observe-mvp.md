# FleetView — Observe MVP Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first web app that auto-discovers Claude Code sessions, normalizes their transcripts into a canonical event stream, and renders a live "colony" agent tree, node inspector, and activity feed — observe-only, end to end.

**Architecture:** A Bun bridge tails `~/.claude/projects/**/*.jsonl` transcript files, normalizes raw entries into canonical `SessionEvent`s, persists them to a SQLite event log, and serves them to a React/Vite UI over WebSocket (backlog replay + live tail). The UI reduces events into a session + agent-tree model and renders it on canvas in the "colony × atelier" visual system. Driving sessions and native-feature UI (permissions, plan, workflow) are out of scope for this plan (Plan 2).

**Tech Stack:** Bun (runtime, workspaces, `bun:sqlite`, `bun test` for the bridge), React 19 + Vite + TypeScript, Tailwind v4, shadcn/ui (Radix), Motion (`motion/react`), HTML canvas, Vitest + jsdom (UI + protocol tests), Zod (event validation).

## Global Constraints

- Local single-user only. No accounts, no cloud, no API key — relies on the user's existing `claude` CLI auth. (Observe path reads transcript files; it needs no auth at all.)
- Monorepo packages: `apps/ui`, `apps/bridge`, `packages/protocol`. The `SessionEvent` contract lives in `packages/protocol` and is the only shared type surface.
- Every `SessionEvent` carries `sessionId: string`, `agentId: string`, `parentAgentId: string | null`, and `seq: number` (monotonic per session).
- Visual system (A×C): cream `#F4F1EA`, paper `#FFFFFF`, ink `#1A1714`, clay `#C96442`, sage `#7C8B6F`, slate `#3D4A52`, hairline `#DCD5C6`, muted `#8C8475`, idle `#C3BBA9`. Fonts: Fraunces (display), Inter (body), JetBrains Mono (data). Status: sage=working, clay=waiting, idle=neutral. Respect `prefers-reduced-motion`; visible keyboard focus.
- Conventional Commits. No AI/LLM attribution in commits anywhere.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

## Task 0: Spike — capture and characterize the transcript format

**Goal:** De-risk the single biggest unknown before writing product code. This task produces *fixtures and findings*, not shipped code.

**Files:**
- Create: `docs/superpowers/spikes/2026-06-28-transcript-format.md`
- Create: `packages/protocol/fixtures/*.jsonl` (captured real transcript excerpts)

- [x] **Step 1: Locate real transcripts**

Run: `ls ~/.claude/projects/ && find ~/.claude/projects -name '*.jsonl' | head`
Expected: at least one `.jsonl` file. If none, run a quick `claude -p "list files here"` in any repo to generate one.

- [x] **Step 2: Generate a transcript that contains subagents and a workflow**

In a scratch repo, run a session that spawns subagents (e.g. ask Claude to "use the Explore agent to find X, then summarize"). Then locate the newest jsonl:
Run: `find ~/.claude/projects -name '*.jsonl' -newermt '-10 min' -print`

- [x] **Step 3: Capture three fixtures**

Copy representative excerpts (anonymize any paths/secrets) into `packages/protocol/fixtures/`:
- `simple-session.jsonl` — a session with user + assistant + tool_use + tool_result, no subagents.
- `subagent-session.jsonl` — a session where the main agent spawns a subagent (Task tool) and the subagent has its own entries (look for `isSidechain: true` and the `parentUuid` chain).
- `workflow-session.jsonl` — if a Workflow ran, a session showing workflow phases / multiple parallel agents.

- [x] **Step 4: Document findings**

In `docs/superpowers/spikes/2026-06-28-transcript-format.md`, record, with concrete examples copied from the fixtures:
- The exact top-level fields on each line (`type`, `uuid`, `parentUuid`, `timestamp`, `sessionId`, `cwd`, `isSidechain`, `message`, etc.).
- How a subagent spawn appears (the `Task` tool_use block) and how subagent entries link back (sidechain + parentUuid).
- How tool calls/results are represented inside `message.content` blocks.
- How (or whether) workflow phases are distinguishable.
- How session "active vs done" can be inferred (e.g. last entry age, a terminal `type`).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/spikes packages/protocol/fixtures
git commit -m "docs: spike findings and fixtures for transcript format"
```

> **Plan adjustment note:** If Step 4 reveals field names different from the assumptions in Task 3 (`RawEntry`) and Task 4 (normalize), update those tasks' field accesses to match the real fixtures before implementing. The structure of the tasks does not change — only the literal field names.

---

## Task 1: Monorepo scaffold + test tooling

**Files:**
- Create: `package.json`, `bunfig.toml`, `tsconfig.base.json`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`
- Create: `apps/bridge/package.json`, `apps/bridge/tsconfig.json`
- Create: `apps/ui/package.json` (filled out in Task 9)
- Create: `packages/protocol/src/index.ts` (temporary smoke export)
- Test: `packages/protocol/src/smoke.test.ts`

**Interfaces:**
- Produces: a Bun workspace where `bun install` works and `bunx vitest run` (in `packages/protocol`) executes tests.

- [ ] **Step 1: Write the root workspace manifest**

`package.json`:
```json
{
  "name": "fleetview",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "bun run --filter '*' test",
    "test:protocol": "cd packages/protocol && bunx vitest run",
    "test:bridge": "cd apps/bridge && bun test",
    "test:ui": "cd apps/ui && bunx vitest run"
  }
}
```

`bunfig.toml`:
```toml
[install]
linker = "isolated"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 2: Scaffold the protocol package**

`packages/protocol/package.json`:
```json
{
  "name": "@fleetview/protocol",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```

`packages/protocol/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/protocol/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

`packages/protocol/src/index.ts`:
```ts
export const PROTOCOL_VERSION = 1;
```

- [ ] **Step 3: Write the smoke test**

`packages/protocol/src/smoke.test.ts`:
```ts
import { expect, test } from "vitest";
import { PROTOCOL_VERSION } from "./index";

test("protocol package builds and exports a version", () => {
  expect(PROTOCOL_VERSION).toBe(1);
});
```

- [ ] **Step 4: Scaffold the bridge package**

`apps/bridge/package.json`:
```json
{
  "name": "@fleetview/bridge",
  "version": "0.0.0",
  "type": "module",
  "dependencies": { "@fleetview/protocol": "workspace:*", "zod": "^3.23.8" },
  "scripts": { "test": "bun test", "dev": "bun run src/main.ts" }
}
```

`apps/bridge/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 5: Install and run the smoke test**

Run: `bun install && cd packages/protocol && bunx vitest run`
Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add package.json bunfig.toml tsconfig.base.json packages apps
git commit -m "chore: scaffold bun monorepo with protocol, bridge, ui packages"
```

---

## Task 2: The `SessionEvent` contract

**Files:**
- Create: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/events.test.ts`

**Interfaces:**
- Produces:
  - `type AgentStatus = "working" | "waiting" | "idle" | "done" | "error"`
  - `type SessionEvent` (discriminated union on `kind`), every member extending `BaseEvent { sessionId: string; agentId: string; parentAgentId: string | null; seq: number; ts: number }`.
  - Event kinds: `"message"` (`role: "user"|"assistant"|"system"`, `text: string`), `"tool_call"` (`callId: string; tool: string; target: string`), `"tool_result"` (`callId: string; ok: boolean; summary: string`), `"subagent_spawn"` (`label: string`), `"subagent_exit"` (`status: AgentStatus`), `"session_status"` (`status: AgentStatus`), `"token_usage"` (`inTokens: number; outTokens: number`).
  - `SessionEventSchema: z.ZodType<SessionEvent>` and `parseSessionEvent(u: unknown): SessionEvent`.

- [ ] **Step 1: Write the failing test**

`packages/protocol/src/events.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/protocol && bunx vitest run src/events.test.ts`
Expected: FAIL — cannot find module `./events`.

- [ ] **Step 3: Implement the contract**

`packages/protocol/src/events.ts`:
```ts
import { z } from "zod";

export type AgentStatus = "working" | "waiting" | "idle" | "done" | "error";

const StatusSchema = z.enum(["working", "waiting", "idle", "done", "error"]);

const Base = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  parentAgentId: z.string().nullable(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
});

export const SessionEventSchema = z.discriminatedUnion("kind", [
  Base.extend({ kind: z.literal("message"), role: z.enum(["user", "assistant", "system"]), text: z.string() }),
  Base.extend({ kind: z.literal("tool_call"), callId: z.string(), tool: z.string(), target: z.string() }),
  Base.extend({ kind: z.literal("tool_result"), callId: z.string(), ok: z.boolean(), summary: z.string() }),
  Base.extend({ kind: z.literal("subagent_spawn"), label: z.string() }),
  Base.extend({ kind: z.literal("subagent_exit"), status: StatusSchema }),
  Base.extend({ kind: z.literal("session_status"), status: StatusSchema }),
  Base.extend({ kind: z.literal("token_usage"), inTokens: z.number().int(), outTokens: z.number().int() }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;

export function parseSessionEvent(u: unknown): SessionEvent {
  return SessionEventSchema.parse(u);
}
```

`packages/protocol/src/index.ts`:
```ts
export const PROTOCOL_VERSION = 1;
export * from "./events";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bunx vitest run`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src
git commit -m "feat(protocol): add SessionEvent contract with zod validation"
```

---

## Task 3: Transcript discovery + raw line reading

**Files:**
- Create: `apps/bridge/src/transcript/discover.ts`
- Create: `apps/bridge/src/transcript/read.ts`
- Test: `apps/bridge/src/transcript/discover.test.ts`, `apps/bridge/src/transcript/read.test.ts`
- Test fixtures: `apps/bridge/src/transcript/__fixtures__/proj/a.jsonl`

**Interfaces:**
- Produces:
  - `discoverSessions(root: string): Promise<DiscoveredSession[]>` where `DiscoveredSession = { sessionId: string; file: string; cwd: string; mtimeMs: number }`.
  - `type RawEntry = { uuid: string; parentUuid: string | null; type: string; sessionId: string; cwd: string; ts: number; isSidechain: boolean; agentId: string | null; attributionAgent: string | null; message: unknown }`.
    - `agentId`: present on sidechain entries (`isSidechain: true`); matches the filename stem of the subagent file (`agent-{agentId}.jsonl`). Always `null` for main-agent entries.
    - `attributionAgent`: present on workflow-subagent entries (e.g. `"workflow-subagent"`); `null` otherwise.
    - Sidechain entries always live in **separate files** (`{session-uuid}/subagents/agent-{agentId}.jsonl`), never mixed into the main `.jsonl`.
  - `readEntries(file: string): Promise<RawEntry[]>` — parses each JSONL line into a `RawEntry`, skipping malformed lines.

> Task 0 spike confirmed top-level fields: `uuid`, `parentUuid`, `type`, `sessionId`, `cwd`, `timestamp`, `isSidechain`, `message`. Additional fields present in real transcripts: `agentId` (on sidechain entries), `attributionAgent` (on workflow-subagent entries). Include both in `RawEntry` for downstream normalize use.

- [ ] **Step 1: Write a fixture transcript**

`apps/bridge/src/transcript/__fixtures__/proj/a.jsonl` (three lines; the third is intentionally malformed):
```
{"uuid":"u1","parentUuid":null,"type":"user","sessionId":"sess-a","cwd":"/home/me/proj","timestamp":"2026-06-28T10:00:00.000Z","isSidechain":false,"message":{"role":"user","content":"hello"}}
{"uuid":"u2","parentUuid":"u1","type":"assistant","sessionId":"sess-a","cwd":"/home/me/proj","timestamp":"2026-06-28T10:00:02.000Z","isSidechain":false,"message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}
{ not valid json
```

- [ ] **Step 2: Write failing tests**

`apps/bridge/src/transcript/read.test.ts`:
```ts
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
```

`apps/bridge/src/transcript/discover.test.ts`:
```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/bridge && bun test src/transcript`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement read.ts**

`apps/bridge/src/transcript/read.ts`:
```ts
export type RawEntry = {
  uuid: string;
  parentUuid: string | null;
  type: string;
  sessionId: string;
  cwd: string;
  ts: number;
  isSidechain: boolean;
  agentId: string | null;        // hex ID of the subagent; present when isSidechain:true; matches agent-{agentId}.jsonl filename stem
  attributionAgent: string | null; // e.g. "workflow-subagent"; present on workflow-subagent entries
  message: unknown;
};

export async function readEntries(file: string): Promise<RawEntry[]> {
  const text = await Bun.file(file).text();
  const out: RawEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const o = JSON.parse(trimmed) as any;
      if (!o.uuid || !o.sessionId) continue;
      out.push({
        uuid: o.uuid,
        parentUuid: o.parentUuid ?? null,
        type: o.type ?? "unknown",
        sessionId: o.sessionId,
        cwd: o.cwd ?? "",
        ts: o.timestamp ? Date.parse(o.timestamp) : 0,
        isSidechain: Boolean(o.isSidechain),
        agentId: o.agentId ?? null,
        attributionAgent: o.attributionAgent ?? null,
        message: o.message ?? null,
      });
    } catch {
      // skip malformed line
    }
  }
  return out;
}
```

- [ ] **Step 5: Implement discover.ts**

`apps/bridge/src/transcript/discover.ts`:
```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/bridge && bun test src/transcript`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/src/transcript
git commit -m "feat(bridge): discover sessions and read raw transcript entries"
```

---

## Task 4: Normalize raw entries → `SessionEvent[]`

**Files:**
- Create: `apps/bridge/src/normalize/normalize.ts`
- Test: `apps/bridge/src/normalize/normalize.test.ts`

**Interfaces:**
- Consumes: `RawEntry` (Task 3), `SessionEvent` (Task 2).
- Produces: `normalize(entries: RawEntry[]): SessionEvent[]`. Rules:
  - `agentId` for main-agent entries (`isSidechain: false`): `"main"`. For sidechain entries: use `RawEntry.agentId` directly (the hex ID present on the entry). `parentAgentId = "main"` for all sidechain entries (MVP: flat hierarchy, direct subagents only).
  - A `type:"assistant"` message whose content contains a `tool_use` block with `name === "Agent"`, `name === "Workflow"`, or `name === "TaskCreate"` emits a `subagent_spawn`. Label: `input.description || input.subagent_type || input.subject || b.name`. NOTE: There is no tool named `"Task"` — the real spawn tools are `"Agent"` (direct subagent), `"Workflow"` (multi-phase, single `scriptPath` input), and `"TaskCreate"` (SDK/queued).
  - Other `tool_use` blocks emit `tool_call` (`callId` = block `id`, `tool` = block `name`, `target` = best-effort from input: `file_path` || `command` || `pattern` || `path` || "").
  - `tool_result` blocks (in `type:"user"` messages) emit `tool_result` (`callId` = `tool_use_id`, `ok` = `!is_error`, `summary` = truncated content).
  - `text` blocks and string content emit `message`.
  - `seq` is a per-session counter assigned in input order, starting at 0.
  - Subagent linkage: sidechain entries come from separate files and carry `RawEntry.agentId` already — do not traverse `parentUuid` to find the agentId. The MVP bridge reads sidechain files separately and their entries already have the correct `agentId`.

- [ ] **Step 1: Write failing tests**

`apps/bridge/src/normalize/normalize.test.ts`:
```ts
import { expect, test } from "bun:test";
import { normalize } from "./normalize";
import type { RawEntry } from "../transcript/read";

const mk = (p: Partial<RawEntry>): RawEntry => ({
  uuid: "u", parentUuid: null, type: "assistant", sessionId: "s1",
  cwd: "/p", ts: 1, isSidechain: false, agentId: null, attributionAgent: null, message: null, ...p,
});

test("text assistant message becomes a message event on main", () => {
  const evs = normalize([mk({ uuid: "u1", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } })]);
  expect(evs).toHaveLength(1);
  expect(evs[0]).toMatchObject({ kind: "message", role: "assistant", text: "hello", agentId: "main", parentAgentId: null, seq: 0 });
});

test("Agent tool_use becomes subagent_spawn", () => {
  const evs = normalize([mk({ uuid: "u2", message: { role: "assistant", content: [
    { type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "Explore", description: "find auth" } },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "subagent_spawn", label: "find auth", agentId: "t1", parentAgentId: "main" });
});

test("Workflow tool_use becomes subagent_spawn", () => {
  const evs = normalize([mk({ uuid: "u2b", message: { role: "assistant", content: [
    { type: "tool_use", id: "wf1", name: "Workflow", input: { scriptPath: "/tmp/ui-ux-workflow.js" } },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "subagent_spawn", agentId: "wf1", parentAgentId: "main" });
});

test("non-spawn tool_use becomes tool_call with target", () => {
  const evs = normalize([mk({ uuid: "u3", message: { role: "assistant", content: [
    { type: "tool_use", id: "c1", name: "Read", input: { file_path: "/p/a.ts" } },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "tool_call", callId: "c1", tool: "Read", target: "/p/a.ts" });
});

test("tool_result becomes tool_result event", () => {
  const evs = normalize([mk({ type: "user", uuid: "u4", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "c1", is_error: false, content: "ok done" },
  ] } })]);
  expect(evs[0]).toMatchObject({ kind: "tool_result", callId: "c1", ok: true });
});

test("seq increments across events", () => {
  const evs = normalize([
    mk({ uuid: "u1", message: { role: "assistant", content: [{ type: "text", text: "a" }] } }),
    mk({ uuid: "u2", message: { role: "assistant", content: [{ type: "text", text: "b" }] } }),
  ]);
  expect(evs.map((e) => e.seq)).toEqual([0, 1]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/bridge && bun test src/normalize`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement normalize.ts**

`apps/bridge/src/normalize/normalize.ts`:
```ts
import type { SessionEvent } from "@fleetview/protocol";
import type { RawEntry } from "../transcript/read";

function targetOf(input: any): string {
  if (!input || typeof input !== "object") return "";
  return input.file_path || input.command || input.pattern || input.path || "";
}

function truncate(c: unknown, n = 200): string {
  const s = typeof c === "string" ? c : JSON.stringify(c);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

const SPAWN_TOOLS = new Set(["Agent", "Workflow", "TaskCreate"]);

export function normalize(entries: RawEntry[]): SessionEvent[] {
  const out: SessionEvent[] = [];
  let seq = 0;

  for (const e of entries) {
    const msg = e.message as any;
    const sessionId = e.sessionId;
    // Sidechain entries carry agentId directly (from the agent-{agentId}.jsonl file).
    // Main-agent entries are always "main".
    const agentId = e.isSidechain && e.agentId ? e.agentId : "main";
    const parentAgentId = agentId === "main" ? null : "main";
    const baseFor = (aId: string) => ({ sessionId, agentId: aId, parentAgentId: aId === "main" ? null : "main", ts: e.ts });

    const content = msg?.content;
    const blocks = Array.isArray(content)
      ? content
      : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];

    for (const b of blocks) {
      if (b.type === "text" && b.text) {
        out.push({ ...baseFor(agentId), seq: seq++, kind: "message", role: msg.role ?? "assistant", text: b.text });
      } else if (b.type === "tool_use" && SPAWN_TOOLS.has(b.name)) {
        // Real spawn tool names: "Agent" (direct subagent), "Workflow" (multi-phase, scriptPath input), "TaskCreate" (SDK/queued).
        const label = b.input?.description || b.input?.subagent_type || b.input?.subject || b.name;
        out.push({ sessionId, agentId: b.id, parentAgentId: "main", ts: e.ts, seq: seq++, kind: "subagent_spawn", label });
      } else if (b.type === "tool_use") {
        out.push({ ...baseFor(agentId), seq: seq++, kind: "tool_call", callId: b.id, tool: b.name, target: targetOf(b.input) });
      } else if (b.type === "tool_result") {
        out.push({ ...baseFor(agentId), seq: seq++, kind: "tool_result", callId: b.tool_use_id, ok: !b.is_error, summary: truncate(b.content) });
      }
    }
  }
  return out;
}
```

> Note on subagent linkage: sidechain entries always live in separate `agent-{agentId}.jsonl` files and carry `agentId` directly on the entry — no `parentUuid` chain traversal needed. The spike confirmed `"isSidechain":true` entries never appear in the main session `.jsonl`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/bridge && bun test src/normalize`
Expected: all PASS.

- [ ] **Step 5: Add a fixture-driven regression test**

Append to `normalize.test.ts`:
```ts
import { readEntries } from "../transcript/read";

test("normalizes the captured subagent fixture without throwing", async () => {
  const file = new URL("../../../../packages/protocol/fixtures/subagent-session.jsonl", import.meta.url).pathname;
  const evs = normalize(await readEntries(file));
  expect(evs.length).toBeGreaterThan(0);
  expect(evs.some((e) => e.kind === "subagent_spawn")).toBe(true);
});
```

Run: `cd apps/bridge && bun test src/normalize`
Expected: PASS. (If it fails, the fixture revealed a real-format difference — fix `normalize.ts`/`read.ts` mappings, this is the point of the fixture test.)

- [ ] **Step 6: Commit**

```bash
git add apps/bridge/src/normalize
git commit -m "feat(bridge): normalize raw transcript entries into SessionEvents"
```

---

## Task 5: SQLite event log

**Files:**
- Create: `apps/bridge/src/store/event-log.ts`
- Test: `apps/bridge/src/store/event-log.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` (Task 2).
- Produces: `class EventLog` with `constructor(path = ":memory:")`, `append(events: SessionEvent[]): void`, `since(sessionId: string, afterSeq: number): SessionEvent[]`, `sessions(): string[]`.

- [ ] **Step 1: Write failing tests**

`apps/bridge/src/store/event-log.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/bridge && bun test src/store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement event-log.ts**

`apps/bridge/src/store/event-log.ts`:
```ts
import { Database } from "bun:sqlite";
import type { SessionEvent } from "@fleetview/protocol";

export class EventLog {
  private db: Database;
  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.run(
      `CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq))`,
    );
  }
  append(events: SessionEvent[]): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO events (session_id, seq, json) VALUES (?, ?, ?)");
    const tx = this.db.transaction((evs: SessionEvent[]) => {
      for (const e of evs) stmt.run(e.sessionId, e.seq, JSON.stringify(e));
    });
    tx(events);
  }
  since(sessionId: string, afterSeq: number): SessionEvent[] {
    const rows = this.db
      .query("SELECT json FROM events WHERE session_id = ? AND seq > ? ORDER BY seq")
      .all(sessionId, afterSeq) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as SessionEvent);
  }
  sessions(): string[] {
    const rows = this.db.query("SELECT DISTINCT session_id FROM events").all() as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/bridge && bun test src/store`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/store
git commit -m "feat(bridge): add sqlite event log with append and replay"
```

---

## Task 6: Session watcher — wire discovery + tail + normalize + log

**Files:**
- Create: `apps/bridge/src/watcher/session-watcher.ts`
- Test: `apps/bridge/src/watcher/session-watcher.test.ts`

**Interfaces:**
- Consumes: `discoverSessions`, `readEntries` (Task 3), `normalize` (Task 4), `EventLog` (Task 5).
- Produces: `class SessionWatcher` with `constructor(root: string, log: EventLog)`, `scanOnce(): Promise<SessionEvent[]>` (discovers files, re-reads changed ones, normalizes, appends *only new* events by seq, returns the newly-appended events), and `onEvents(cb: (events: SessionEvent[]) => void): void`.

- [ ] **Step 1: Write failing test**

`apps/bridge/src/watcher/session-watcher.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bridge && bun test src/watcher`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement session-watcher.ts**

`apps/bridge/src/watcher/session-watcher.ts`:
```ts
import type { SessionEvent } from "@fleetview/protocol";
import { discoverSessions } from "../transcript/discover";
import { readEntries } from "../transcript/read";
import { normalize } from "../normalize/normalize";
import type { EventLog } from "../store/event-log";

export class SessionWatcher {
  private highestSeq = new Map<string, number>(); // sessionId -> last appended seq
  private listeners: ((events: SessionEvent[]) => void)[] = [];
  constructor(private root: string, private log: EventLog) {}

  onEvents(cb: (events: SessionEvent[]) => void): void {
    this.listeners.push(cb);
  }

  async scanOnce(): Promise<SessionEvent[]> {
    const sessions = await discoverSessions(this.root);
    const fresh: SessionEvent[] = [];
    for (const s of sessions) {
      const all = normalize(await readEntries(s.file));
      const last = this.highestSeq.get(s.sessionId) ?? -1;
      const newOnes = all.filter((e) => e.seq > last);
      if (newOnes.length === 0) continue;
      this.log.append(newOnes);
      this.highestSeq.set(s.sessionId, newOnes[newOnes.length - 1].seq);
      fresh.push(...newOnes);
    }
    if (fresh.length) for (const cb of this.listeners) cb(fresh);
    return fresh;
  }

  start(intervalMs = 750): () => void {
    const timer = setInterval(() => void this.scanOnce(), intervalMs);
    return () => clearInterval(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bridge && bun test src/watcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/watcher
git commit -m "feat(bridge): session watcher wiring discovery, normalize, and log"
```

---

## Task 7: WebSocket server + HTTP static serving

**Files:**
- Create: `apps/bridge/src/server.ts`
- Create: `apps/bridge/src/main.ts`
- Create: `apps/bridge/src/ws-protocol.ts`
- Test: `apps/bridge/src/server.test.ts`

**Interfaces:**
- Consumes: `EventLog` (Task 5), `SessionWatcher` (Task 6).
- Produces:
  - `ws-protocol.ts`: `type ClientMsg = { type: "subscribe"; sessionId: string; afterSeq: number } | { type: "list" }`; `type ServerMsg = { type: "events"; events: SessionEvent[] } | { type: "sessions"; sessions: string[] }`.
  - `server.ts`: `createServer(opts: { log: EventLog; watcher: SessionWatcher; uiDir?: string; port: number }): { stop(): void; port: number }`. On WS `subscribe`, replays `log.since(sessionId, afterSeq)` then streams live events for that session; on `list`, returns `log.sessions()`.

- [ ] **Step 1: Write failing test**

`apps/bridge/src/server.test.ts`:
```ts
import { expect, test } from "bun:test";
import { createServer } from "./server";
import { EventLog } from "./store/event-log";
import { SessionWatcher } from "./watcher/session-watcher";
import type { SessionEvent } from "@fleetview/protocol";

const ev = (seq: number): SessionEvent => ({ sessionId: "s1", agentId: "main", parentAgentId: null, seq, ts: seq, kind: "message", role: "assistant", text: "hi" });

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bridge && bun test src/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ws-protocol.ts**

`apps/bridge/src/ws-protocol.ts`:
```ts
import type { SessionEvent } from "@fleetview/protocol";
export type ClientMsg = { type: "subscribe"; sessionId: string; afterSeq: number } | { type: "list" };
export type ServerMsg = { type: "events"; events: SessionEvent[] } | { type: "sessions"; sessions: string[] };
```

- [ ] **Step 4: Implement server.ts**

`apps/bridge/src/server.ts`:
```ts
import { join } from "node:path";
import type { SessionEvent } from "@fleetview/protocol";
import type { EventLog } from "./store/event-log";
import type { SessionWatcher } from "./watcher/session-watcher";
import type { ClientMsg } from "./ws-protocol";

type WS = { data: { sessionId?: string }; send: (s: string) => void };

export function createServer(opts: { log: EventLog; watcher: SessionWatcher; uiDir?: string; port: number }) {
  const subscribers = new Set<WS>();
  opts.watcher.onEvents((events) => {
    for (const ws of subscribers) {
      const sid = ws.data.sessionId;
      const slice = sid ? events.filter((e) => e.sessionId === sid) : [];
      if (slice.length) ws.send(JSON.stringify({ type: "events", events: slice }));
    }
  });

  const server = Bun.serve({
    port: opts.port,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        if (srv.upgrade(req, { data: {} })) return;
        return new Response("upgrade failed", { status: 400 });
      }
      if (opts.uiDir) {
        const rel = url.pathname === "/" ? "/index.html" : url.pathname;
        const file = Bun.file(join(opts.uiDir, rel));
        return file.exists().then((ok) => (ok ? new Response(file) : new Response(Bun.file(join(opts.uiDir!, "/index.html")))));
      }
      return new Response("FleetView bridge", { status: 200 });
    },
    websocket: {
      open(ws: any) { subscribers.add(ws); },
      close(ws: any) { subscribers.delete(ws); },
      message(ws: any, raw: string) {
        const msg = JSON.parse(raw) as ClientMsg;
        if (msg.type === "list") {
          ws.send(JSON.stringify({ type: "sessions", sessions: opts.log.sessions() }));
        } else if (msg.type === "subscribe") {
          ws.data.sessionId = msg.sessionId;
          const backlog: SessionEvent[] = opts.log.since(msg.sessionId, msg.afterSeq);
          ws.send(JSON.stringify({ type: "events", events: backlog }));
        }
      },
    },
  });
  return { stop: () => server.stop(true), port: server.port };
}
```

`apps/bridge/src/main.ts`:
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { EventLog } from "./store/event-log";
import { SessionWatcher } from "./watcher/session-watcher";
import { createServer } from "./server";

const root = join(homedir(), ".claude", "projects");
const log = new EventLog(join(homedir(), ".fleetview.sqlite"));
const watcher = new SessionWatcher(root, log);
watcher.start(750);
const uiDir = process.env.FLEETVIEW_UI_DIR;
const port = Number(process.env.PORT ?? 4317);
const srv = createServer({ log, watcher, uiDir, port });
console.log(`FleetView bridge on http://localhost:${srv.port}`);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/bridge && bun test src/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bridge/src/server.ts apps/bridge/src/main.ts apps/bridge/src/ws-protocol.ts apps/bridge/src/server.test.ts
git commit -m "feat(bridge): websocket server with backlog replay and live streaming"
```

---

## Task 8: UI scaffold (Vite + Tailwind v4 + theme tokens)

**Files:**
- Create: `apps/ui/package.json`, `apps/ui/vite.config.ts`, `apps/ui/tsconfig.json`, `apps/ui/index.html`
- Create: `apps/ui/src/main.tsx`, `apps/ui/src/App.tsx`, `apps/ui/src/theme.css`
- Create: `apps/ui/vitest.config.ts`
- Test: `apps/ui/src/App.test.tsx`

**Interfaces:**
- Produces: a Vite React app that builds, renders the FleetView shell with the A×C theme tokens available as CSS variables, and runs Vitest under jsdom.

- [ ] **Step 1: Fill in apps/ui/package.json**

```json
{
  "name": "@fleetview/ui",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "test": "vitest run" },
  "dependencies": {
    "@fleetview/protocol": "workspace:*",
    "react": "^19.0.0", "react-dom": "^19.0.0", "motion": "^11.11.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0", "vite": "^6.0.0", "typescript": "^5.6.0",
    "tailwindcss": "^4.0.0", "@tailwindcss/vite": "^4.0.0",
    "vitest": "^2.1.0", "jsdom": "^25.0.0",
    "@testing-library/react": "^16.0.0", "@testing-library/jest-dom": "^6.5.0"
  }
}
```

- [ ] **Step 2: Add config files**

`apps/ui/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({ plugins: [react(), tailwind()], server: { proxy: { "/ws": { target: "ws://localhost:4317", ws: true } } } });
```

`apps/ui/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], globals: true } });
```

`apps/ui/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vitest/globals"] }, "include": ["src"] }
```

`apps/ui/src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 3: Add theme + HTML + entry**

`apps/ui/src/theme.css`:
```css
@import "tailwindcss";
@theme {
  --color-cream: #F4F1EA; --color-paper: #FFFFFF; --color-ink: #1A1714;
  --color-clay: #C96442; --color-sage: #7C8B6F; --color-slate: #3D4A52;
  --color-hairline: #DCD5C6; --color-muted: #8C8475; --color-idle: #C3BBA9;
  --font-display: "Fraunces", serif; --font-body: "Inter", sans-serif; --font-mono: "JetBrains Mono", monospace;
}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
body { background: var(--color-cream); color: var(--color-ink); font-family: var(--font-body); margin: 0; }
```

`apps/ui/index.html`:
```html
<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" /><title>FleetView</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
</head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`apps/ui/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
```

`apps/ui/src/App.tsx`:
```tsx
export function App() {
  return (
    <div data-testid="app-shell" className="h-screen grid" style={{ gridTemplateColumns: "240px 1fr 300px" }}>
      <aside className="border-r border-hairline p-4"><h1 className="font-display text-xl">FleetView</h1></aside>
      <main className="relative" />
      <aside className="border-l border-hairline p-4" />
    </div>
  );
}
```

- [ ] **Step 4: Write the failing test**

`apps/ui/src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the FleetView shell", () => {
  render(<App />);
  expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  expect(screen.getByText("FleetView")).toBeInTheDocument();
});
```

- [ ] **Step 5: Install, run test, build**

Run: `bun install && cd apps/ui && bunx vitest run && bunx vite build`
Expected: test PASS; build writes `dist/`.

- [ ] **Step 6: Commit**

```bash
git add apps/ui
git commit -m "feat(ui): scaffold vite react app with A×C theme tokens"
```

---

## Task 9: UI event store + WebSocket client hook

**Files:**
- Create: `apps/ui/src/store/reduce.ts`
- Create: `apps/ui/src/store/useSession.ts`
- Test: `apps/ui/src/store/reduce.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` (protocol), `ClientMsg`/`ServerMsg` shapes (mirror Task 7; redefine locally to avoid importing bridge).
- Produces:
  - `type AgentNode = { agentId: string; parentAgentId: string | null; label: string; status: AgentStatus; tokens: number; tools: number }`.
  - `type SessionState = { agents: Map<string, AgentNode>; events: SessionEvent[]; lastSeq: number }`.
  - `reduce(state: SessionState, event: SessionEvent): SessionState` (pure).
  - `useSession(sessionId: string | null): SessionState` — opens `/ws`, subscribes, applies events via `reduce`.

- [ ] **Step 1: Write failing tests**

`apps/ui/src/store/reduce.test.ts`:
```ts
import { reduce, emptyState } from "./reduce";
import type { SessionEvent } from "@fleetview/protocol";

const e = (p: Partial<SessionEvent> & Pick<SessionEvent, "kind">): SessionEvent =>
  ({ sessionId: "s1", agentId: "main", parentAgentId: null, seq: 0, ts: 0, ...(p as any) });

test("subagent_spawn adds a child agent node", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "subagent_spawn", agentId: "a2", parentAgentId: "main", label: "explore", seq: 1 } as any));
  expect(s.agents.get("a2")).toMatchObject({ label: "explore", parentAgentId: "main", status: "working" });
});

test("tool_call increments the agent tool count", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "subagent_spawn", agentId: "a2", parentAgentId: "main", label: "x", seq: 1 } as any));
  s = reduce(s, e({ kind: "tool_call", agentId: "a2", parentAgentId: "main", callId: "c1", tool: "Read", target: "/a", seq: 2 } as any));
  expect(s.agents.get("a2")!.tools).toBe(1);
});

test("subagent_exit sets status done and tracks lastSeq", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "subagent_spawn", agentId: "a2", parentAgentId: "main", label: "x", seq: 1 } as any));
  s = reduce(s, e({ kind: "subagent_exit", agentId: "a2", parentAgentId: "main", status: "done", seq: 3 } as any));
  expect(s.agents.get("a2")!.status).toBe("done");
  expect(s.lastSeq).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ui && bunx vitest run src/store/reduce.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement reduce.ts**

`apps/ui/src/store/reduce.ts`:
```ts
import type { AgentStatus, SessionEvent } from "@fleetview/protocol";

export type AgentNode = {
  agentId: string; parentAgentId: string | null; label: string;
  status: AgentStatus; tokens: number; tools: number;
};
export type SessionState = { agents: Map<string, AgentNode>; events: SessionEvent[]; lastSeq: number };

export function emptyState(): SessionState {
  return {
    agents: new Map([["main", { agentId: "main", parentAgentId: null, label: "main", status: "working", tokens: 0, tools: 0 }]]),
    events: [], lastSeq: -1,
  };
}

function ensure(agents: Map<string, AgentNode>, id: string, parent: string | null): AgentNode {
  let n = agents.get(id);
  if (!n) { n = { agentId: id, parentAgentId: parent, label: id, status: "working", tokens: 0, tools: 0 }; agents.set(id, n); }
  return n;
}

export function reduce(state: SessionState, ev: SessionEvent): SessionState {
  const agents = new Map(state.agents);
  switch (ev.kind) {
    case "subagent_spawn": {
      agents.set(ev.agentId, { agentId: ev.agentId, parentAgentId: ev.parentAgentId, label: ev.label, status: "working", tokens: 0, tools: 0 });
      break;
    }
    case "subagent_exit": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, status: ev.status });
      break;
    }
    case "tool_call": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, tools: n.tools + 1 });
      break;
    }
    case "token_usage": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, tokens: n.tokens + ev.inTokens + ev.outTokens });
      break;
    }
    case "session_status": {
      const n = ensure(agents, ev.agentId, ev.parentAgentId); agents.set(ev.agentId, { ...n, status: ev.status });
      break;
    }
  }
  return { agents, events: [...state.events, ev], lastSeq: Math.max(state.lastSeq, ev.seq) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/ui && bunx vitest run src/store/reduce.test.ts`
Expected: all PASS.

- [ ] **Step 5: Implement the WS hook (no separate test; covered by integration in Task 13 manual check)**

`apps/ui/src/store/useSession.ts`:
```ts
import { useEffect, useRef, useState } from "react";
import type { SessionEvent } from "@fleetview/protocol";
import { emptyState, reduce, type SessionState } from "./reduce";

export function useSession(sessionId: string | null): SessionState {
  const [state, setState] = useState<SessionState>(emptyState());
  const ref = useRef<SessionState>(state);
  useEffect(() => {
    if (!sessionId) return;
    ref.current = emptyState(); setState(ref.current);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", sessionId, afterSeq: -1 }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type !== "events") return;
      for (const ev of msg.events as SessionEvent[]) ref.current = reduce(ref.current, ev);
      setState({ ...ref.current });
    };
    return () => ws.close();
  }, [sessionId]);
  return state;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/store
git commit -m "feat(ui): event store reducer and websocket session hook"
```

---

## Task 10: Sessions sidebar + session list hook

**Files:**
- Create: `apps/ui/src/store/useSessions.ts`
- Create: `apps/ui/src/components/Sidebar.tsx`
- Modify: `apps/ui/src/App.tsx`
- Test: `apps/ui/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `useSession` (Task 9).
- Produces: `Sidebar({ sessions, activeId, onSelect }: { sessions: SessionSummary[]; activeId: string | null; onSelect: (id: string) => void })` where `SessionSummary = { sessionId: string; label: string; status: AgentStatus }`; `useSessions(): SessionSummary[]`.

- [ ] **Step 1: Write the failing test**

`apps/ui/src/components/Sidebar.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

test("renders sessions and fires onSelect", () => {
  const onSelect = vi.fn();
  render(<Sidebar sessions={[{ sessionId: "s1", label: "refactor-auth", status: "working" }]} activeId={null} onSelect={onSelect} />);
  fireEvent.click(screen.getByText("refactor-auth"));
  expect(onSelect).toHaveBeenCalledWith("s1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ui && bunx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Sidebar.tsx**

`apps/ui/src/components/Sidebar.tsx`:
```tsx
import type { AgentStatus } from "@fleetview/protocol";
export type SessionSummary = { sessionId: string; label: string; status: AgentStatus };
const pip: Record<AgentStatus, string> = { working: "var(--color-sage)", waiting: "var(--color-clay)", idle: "var(--color-idle)", done: "var(--color-idle)", error: "var(--color-clay)" };

export function Sidebar({ sessions, activeId, onSelect }: { sessions: SessionSummary[]; activeId: string | null; onSelect: (id: string) => void }) {
  return (
    <aside className="border-r border-hairline p-4">
      <h1 className="font-display text-xl mb-4">FleetView</h1>
      <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-3 font-mono">Sessions</div>
      <ul>
        {sessions.map((s) => (
          <li key={s.sessionId}>
            <button onClick={() => onSelect(s.sessionId)}
              className={`w-full text-left rounded-xl px-3 py-2.5 mb-1.5 flex items-center gap-2 ${activeId === s.sessionId ? "bg-paper shadow" : "hover:bg-[var(--color-hairline)]/40"}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: pip[s.status] }} />
              <span className="text-sm font-semibold">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ui && bunx vitest run src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implement useSessions.ts and wire App**

`apps/ui/src/store/useSessions.ts`:
```ts
import { useEffect, useState } from "react";
import type { SessionSummary } from "../components/Sidebar";

export function useSessions(): SessionSummary[] {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "list" }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type === "sessions") setSessions(msg.sessions.map((id: string) => ({ sessionId: id, label: id.slice(0, 8), status: "idle" as const })));
    };
    return () => ws.close();
  }, []);
  return sessions;
}
```

`apps/ui/src/App.tsx` (replace body):
```tsx
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { useSessions } from "./store/useSessions";
import { useSession } from "./store/useSession";

export function App() {
  const sessions = useSessions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const session = useSession(activeId);
  return (
    <div data-testid="app-shell" className="h-screen grid" style={{ gridTemplateColumns: "240px 1fr 300px" }}>
      <Sidebar sessions={sessions} activeId={activeId} onSelect={setActiveId} />
      <main className="relative" data-agent-count={session.agents.size} />
      <aside className="border-l border-hairline p-4" />
    </div>
  );
}
```

- [ ] **Step 6: Run all UI tests + commit**

Run: `cd apps/ui && bunx vitest run`
Expected: all PASS.
```bash
git add apps/ui/src
git commit -m "feat(ui): sessions sidebar and session list hook"
```

---

## Task 11: Colony tree canvas

**Files:**
- Create: `apps/ui/src/tree/layout.ts`
- Create: `apps/ui/src/tree/ColonyTree.tsx`
- Modify: `apps/ui/src/App.tsx`
- Test: `apps/ui/src/tree/layout.test.ts`

**Interfaces:**
- Consumes: `AgentNode` (Task 9).
- Produces:
  - `layout(agents: Map<string, AgentNode>, w: number, h: number): PositionedNode[]` where `PositionedNode = AgentNode & { x: number; y: number; r: number; depth: number }` — root ("main") centered, children radially placed by depth.
  - `ColonyTree({ agents, onSelect, selectedId }: { agents: Map<string, AgentNode>; onSelect: (id: string) => void; selectedId: string | null })` — canvas renderer with the A×C node/edge styling and click hit-testing.

- [ ] **Step 1: Write the failing test (pure layout only)**

`apps/ui/src/tree/layout.test.ts`:
```ts
import { layout } from "./layout";
import type { AgentNode } from "../store/reduce";

const node = (id: string, parent: string | null): AgentNode => ({ agentId: id, parentAgentId: parent, label: id, status: "working", tokens: 0, tools: 0 });

test("places root at center and children around it", () => {
  const agents = new Map<string, AgentNode>([
    ["main", node("main", null)], ["a", node("a", "main")], ["b", node("b", "main")],
  ]);
  const positioned = layout(agents, 1000, 800);
  const root = positioned.find((p) => p.agentId === "main")!;
  expect(Math.round(root.x)).toBe(500);
  expect(root.depth).toBe(0);
  const a = positioned.find((p) => p.agentId === "a")!;
  expect(a.depth).toBe(1);
  expect(a.x === root.x && a.y === root.y).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ui && bunx vitest run src/tree/layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement layout.ts**

`apps/ui/src/tree/layout.ts`:
```ts
import type { AgentNode } from "../store/reduce";

export type PositionedNode = AgentNode & { x: number; y: number; r: number; depth: number };

export function layout(agents: Map<string, AgentNode>, w: number, h: number): PositionedNode[] {
  const cx = w / 2, cy = h / 2;
  const byParent = new Map<string | null, AgentNode[]>();
  for (const a of agents.values()) {
    const k = a.parentAgentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(a);
  }
  const out: PositionedNode[] = [];
  function place(node: AgentNode, x: number, y: number, depth: number, a0: number, a1: number) {
    out.push({ ...node, x, y, depth, r: depth === 0 ? 24 : Math.max(9, 16 - depth * 2) });
    const kids = byParent.get(node.agentId) ?? [];
    const span = a1 - a0;
    kids.forEach((kid, i) => {
      const frac = kids.length === 1 ? 0.5 : i / (kids.length - 1);
      const ang = a0 + span * frac;
      const dist = 150 + depth * 30;
      place(kid, x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, depth + 1, ang - 0.6, ang + 0.6);
    });
  }
  const root = agents.get("main");
  if (root) place(root, cx, cy, 0, -Math.PI, 0);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ui && bunx vitest run src/tree/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement ColonyTree.tsx**

`apps/ui/src/tree/ColonyTree.tsx`:
```tsx
import { useEffect, useRef } from "react";
import type { AgentNode, } from "../store/reduce";
import { layout, type PositionedNode } from "./layout";

const COL = { working: "#7C8B6F", waiting: "#C96442", idle: "#C3BBA9", done: "#C3BBA9", error: "#C96442" } as const;
const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ColonyTree({ agents, onSelect, selectedId }: { agents: Map<string, AgentNode>; onSelect: (id: string) => void; selectedId: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<PositionedNode[]>([]);

  useEffect(() => {
    const cv = ref.current!; const x = cv.getContext("2d")!;
    let raf = 0; let t = 0;
    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const r = cv.getBoundingClientRect();
      cv.width = r.width * dpr; cv.height = r.height * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const nodes = layout(agents, r.width, r.height); nodesRef.current = nodes;
      const byId = new Map(nodes.map((n) => [n.agentId, n] as const));
      x.clearRect(0, 0, r.width, r.height);
      // edges
      for (const n of nodes) {
        if (!n.parentAgentId) continue;
        const p = byId.get(n.parentAgentId); if (!p) continue;
        const mx = (p.x + n.x) / 2, my = (p.y + n.y) / 2 - 16;
        x.strokeStyle = "rgba(26,23,20,0.30)"; x.lineWidth = 1.5; x.beginPath();
        x.moveTo(p.x, p.y); x.quadraticCurveTo(mx, my, n.x, n.y); x.stroke();
        if (!reduced && n.status === "working") {
          for (let k = 0; k < 3; k++) {
            const pr = ((t * 0.4) + k / 3) % 1;
            const ix = (1 - pr) ** 2 * p.x + 2 * (1 - pr) * pr * mx + pr * pr * n.x;
            const iy = (1 - pr) ** 2 * p.y + 2 * (1 - pr) * pr * my + pr * pr * n.y;
            x.fillStyle = COL[n.status]; x.globalAlpha = 0.8 * (1 - Math.abs(pr - 0.5) * 1.3);
            x.beginPath(); x.arc(ix, iy, 2.2, 0, 7); x.fill(); x.globalAlpha = 1;
          }
        }
      }
      // nodes
      for (const n of nodes) {
        const pulse = reduced ? 0.5 : Math.sin(t * 2 + n.x) * 0.5 + 0.5;
        const c = COL[n.status];
        if (n.agentId === selectedId) { x.beginPath(); x.arc(n.x, n.y, n.r + 12, 0, 7); x.setLineDash([4, 5]); x.strokeStyle = "#C96442"; x.lineWidth = 1.5; x.stroke(); x.setLineDash([]); }
        x.beginPath(); x.arc(n.x, n.y, n.r + 7 + pulse * 6, 0, 7); x.fillStyle = c; x.globalAlpha = 0.1 + pulse * 0.08; x.fill(); x.globalAlpha = 1;
        x.beginPath(); x.arc(n.x, n.y, n.r, 0, 7); x.fillStyle = "#fff"; x.fill();
        x.lineWidth = n.depth === 0 ? 2.4 : 2; x.strokeStyle = n.depth === 0 ? "#1A1714" : c; x.stroke();
        x.fillStyle = "#1A1714"; x.textAlign = "center"; x.font = `${n.depth === 0 ? "600 14px" : "500 11px"} "JetBrains Mono", monospace`;
        x.fillText(n.label, n.x, n.y + n.r + 16);
      }
      t += 0.016; raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [agents, selectedId]);

  const onClick = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    for (const n of nodesRef.current) if ((mx - n.x) ** 2 + (my - n.y) ** 2 <= (n.r + 8) ** 2) { onSelect(n.agentId); return; }
  };
  return <canvas ref={ref} onClick={onClick} className="absolute inset-0 w-full h-full" />;
}
```

- [ ] **Step 6: Wire into App.tsx main panel**

In `apps/ui/src/App.tsx`, add `selectedAgent` state and replace the `<main>` element:
```tsx
// add: import { ColonyTree } from "./tree/ColonyTree";
// add inside App: const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
<main className="relative" data-agent-count={session.agents.size}>
  {activeId && <ColonyTree agents={session.agents} onSelect={setSelectedAgent} selectedId={selectedAgent} />}
</main>
```

- [ ] **Step 7: Run tests + build + commit**

Run: `cd apps/ui && bunx vitest run && bunx vite build`
Expected: tests PASS; build succeeds.
```bash
git add apps/ui/src
git commit -m "feat(ui): colony tree canvas with radial layout and click selection"
```

---

## Task 12: Node inspector drawer

**Files:**
- Create: `apps/ui/src/inspector/NodeInspector.tsx`
- Create: `apps/ui/src/inspector/select-agent-events.ts`
- Modify: `apps/ui/src/App.tsx`
- Test: `apps/ui/src/inspector/select-agent-events.test.ts`, `apps/ui/src/inspector/NodeInspector.test.tsx`

**Interfaces:**
- Consumes: `SessionState` (Task 9), `SessionEvent` (protocol).
- Produces:
  - `selectAgentEvents(state: SessionState, agentId: string): SessionEvent[]` (pure filter, order preserved).
  - `NodeInspector({ state, agentId, onClose }: { state: SessionState; agentId: string | null; onClose: () => void })` — renders the selected agent's transcript (messages, tool cards) + stats; null when `agentId` is null.

- [ ] **Step 1: Write failing tests**

`apps/ui/src/inspector/select-agent-events.test.ts`:
```ts
import { selectAgentEvents } from "./select-agent-events";
import { emptyState, reduce } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";

const e = (p: Partial<SessionEvent> & Pick<SessionEvent, "kind">): SessionEvent => ({ sessionId: "s1", agentId: "main", parentAgentId: null, seq: 0, ts: 0, ...(p as any) });

test("returns only the selected agent's events", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "message", agentId: "main", role: "assistant", text: "root", seq: 0 } as any));
  s = reduce(s, e({ kind: "message", agentId: "a2", parentAgentId: "main", role: "assistant", text: "child", seq: 1 } as any));
  expect(selectAgentEvents(s, "a2").map((x: any) => x.text)).toEqual(["child"]);
});
```

`apps/ui/src/inspector/NodeInspector.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { NodeInspector } from "./NodeInspector";
import { emptyState, reduce } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";

const e = (p: any): SessionEvent => ({ sessionId: "s1", agentId: "a2", parentAgentId: "main", seq: 0, ts: 0, ...p });

test("shows the agent transcript text and a tool card", () => {
  let s = emptyState();
  s = reduce(s, e({ kind: "subagent_spawn", label: "explore", seq: 1 }));
  s = reduce(s, e({ kind: "message", role: "assistant", text: "reading files", seq: 2 }));
  s = reduce(s, e({ kind: "tool_call", callId: "c1", tool: "Read", target: "/a.ts", seq: 3 }));
  render(<NodeInspector state={s} agentId="a2" onClose={() => {}} />);
  expect(screen.getByText("reading files")).toBeInTheDocument();
  expect(screen.getByText("Read")).toBeInTheDocument();
});

test("renders nothing when no agent selected", () => {
  const { container } = render(<NodeInspector state={emptyState()} agentId={null} onClose={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ui && bunx vitest run src/inspector`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement select-agent-events.ts**

`apps/ui/src/inspector/select-agent-events.ts`:
```ts
import type { SessionState } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";
export function selectAgentEvents(state: SessionState, agentId: string): SessionEvent[] {
  return state.events.filter((e) => e.agentId === agentId);
}
```

- [ ] **Step 4: Implement NodeInspector.tsx**

`apps/ui/src/inspector/NodeInspector.tsx`:
```tsx
import type { SessionState } from "../store/reduce";
import { selectAgentEvents } from "./select-agent-events";

export function NodeInspector({ state, agentId, onClose }: { state: SessionState; agentId: string | null; onClose: () => void }) {
  if (!agentId) return null;
  const node = state.agents.get(agentId);
  const events = selectAgentEvents(state, agentId);
  return (
    <aside className="border-l border-hairline bg-paper h-full flex flex-col">
      <header className="p-5 border-b border-hairline">
        <div className="font-mono text-[10.5px] text-muted">{agentId}</div>
        <h3 className="font-display text-2xl mt-2 flex items-center gap-2">{node?.label ?? agentId}</h3>
        <div className="flex gap-4 mt-3 font-mono text-[11px] text-muted">
          <span>tools <b className="text-ink">{node?.tools ?? 0}</b></span>
          <span>tokens <b className="text-ink">{node?.tokens ?? 0}</b></span>
          <span>status <b className="text-ink">{node?.status}</b></span>
        </div>
        <button onClick={onClose} className="sr-only">Close</button>
      </header>
      <div className="flex-1 overflow-auto p-5 space-y-3">
        {events.map((e, i) => {
          if (e.kind === "message") return <p key={i} className="text-sm leading-relaxed">{e.text}</p>;
          if (e.kind === "tool_call") return (
            <div key={i} className="border border-hairline rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-cream font-mono text-[11.5px]"><span className="text-clay">▸</span><b className="font-medium">{e.tool}</b><span className="text-muted">{e.target}</span></div>
            </div>
          );
          if (e.kind === "tool_result") return <div key={i} className="font-mono text-[11px] text-slate px-3">{e.ok ? "✓" : "✗"} {e.summary}</div>;
          return null;
        })}
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Wire into App.tsx right panel**

Replace the right `<aside>` in `apps/ui/src/App.tsx`:
```tsx
// add: import { NodeInspector } from "./inspector/NodeInspector";
<div className="border-l border-hairline">
  {selectedAgent
    ? <NodeInspector state={session} agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
    : <aside className="p-4" />}
</div>
```
Update the grid to give the inspector room: keep `gridTemplateColumns: "240px 1fr 360px"`.

- [ ] **Step 6: Run tests + build + commit**

Run: `cd apps/ui && bunx vitest run && bunx vite build`
Expected: all PASS; build succeeds.
```bash
git add apps/ui/src
git commit -m "feat(ui): node inspector drawer with per-agent transcript"
```

---

## Task 13: Activity feed + end-to-end manual verification

**Files:**
- Create: `apps/ui/src/feed/ActivityFeed.tsx`
- Create: `apps/ui/src/feed/describe-event.ts`
- Modify: `apps/ui/src/App.tsx`
- Test: `apps/ui/src/feed/describe-event.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` (protocol), `SessionState` (Task 9).
- Produces: `describeEvent(e: SessionEvent): { actor: string; text: string } | null`; `ActivityFeed({ state }: { state: SessionState })` — renders the most recent ~30 described events newest-first.

- [ ] **Step 1: Write failing test**

`apps/ui/src/feed/describe-event.test.ts`:
```ts
import { describeEvent } from "./describe-event";
import type { SessionEvent } from "@fleetview/protocol";
const e = (p: any): SessionEvent => ({ sessionId: "s1", agentId: "a2", parentAgentId: "main", seq: 0, ts: 0, ...p });

test("describes a subagent spawn", () => {
  expect(describeEvent(e({ kind: "subagent_spawn", label: "explore" }))).toEqual({ actor: "a2", text: "spawned subagent explore" });
});
test("describes a tool call", () => {
  expect(describeEvent(e({ kind: "tool_call", tool: "Read", target: "/a.ts", callId: "c" }))).toEqual({ actor: "a2", text: "Read /a.ts" });
});
test("returns null for token_usage (not feed-worthy)", () => {
  expect(describeEvent(e({ kind: "token_usage", inTokens: 1, outTokens: 2 }))).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ui && bunx vitest run src/feed/describe-event.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement describe-event.ts + ActivityFeed.tsx**

`apps/ui/src/feed/describe-event.ts`:
```ts
import type { SessionEvent } from "@fleetview/protocol";
export function describeEvent(e: SessionEvent): { actor: string; text: string } | null {
  switch (e.kind) {
    case "subagent_spawn": return { actor: e.agentId, text: `spawned subagent ${e.label}` };
    case "tool_call": return { actor: e.agentId, text: `${e.tool} ${e.target}`.trim() };
    case "tool_result": return { actor: e.agentId, text: `${e.ok ? "✓" : "✗"} ${e.summary}` };
    case "subagent_exit": return { actor: e.agentId, text: `exited (${e.status})` };
    case "message": return e.role === "assistant" ? { actor: e.agentId, text: e.text.slice(0, 80) } : null;
    default: return null;
  }
}
```

`apps/ui/src/feed/ActivityFeed.tsx`:
```tsx
import type { SessionState } from "../store/reduce";
import { describeEvent } from "./describe-event";

export function ActivityFeed({ state }: { state: SessionState }) {
  const items = state.events.map(describeEvent).filter(Boolean).slice(-30).reverse() as { actor: string; text: string }[];
  return (
    <aside className="border-l border-hairline p-4 overflow-auto">
      <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-3 font-mono">Activity</div>
      {items.map((it, i) => (
        <div key={i} className="text-[12.5px] py-2 border-b border-hairline text-slate">
          <b className="text-ink font-semibold">{it.actor}</b> {it.text}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 4: Wire App so the right panel shows feed when no agent is selected**

In `apps/ui/src/App.tsx`, change the right-panel branch to fall back to the feed:
```tsx
{selectedAgent
  ? <NodeInspector state={session} agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
  : <ActivityFeed state={session} />}
```
(Add `import { ActivityFeed } from "./feed/ActivityFeed";`.)

- [ ] **Step 5: Run all tests + build**

Run: `cd apps/ui && bunx vitest run && bunx vite build`
Expected: all PASS; build succeeds.

- [ ] **Step 6: End-to-end manual verification against real data**

Run the bridge against your real transcripts and the built UI:
```bash
cd apps/ui && bunx vite build
FLEETVIEW_UI_DIR="$PWD/dist" PORT=4317 bun run ../bridge/src/main.ts
```
Open `http://localhost:4317`. Verify:
- The sidebar lists your real sessions.
- Selecting a session renders the colony tree; sessions that used subagents show child nodes.
- Clicking a node opens the inspector with that agent's transcript and tool cards.
- The activity feed shows described events.

Record any format mismatches and fix `normalize.ts` (these are real-data findings the unit fixtures may not have covered).

- [ ] **Step 7: Commit**

```bash
git add apps/ui/src
git commit -m "feat(ui): activity feed and end-to-end observe wiring"
```

---

## Task 14: One-command start (`fleetview` launcher)

**Files:**
- Create: `apps/bridge/src/cli.ts`
- Modify: `apps/bridge/package.json` (add `bin`)
- Create: `scripts/build-all.sh`
- Test: manual (CLI smoke)

**Interfaces:**
- Produces: `fleetview` binary that builds (if needed) and serves the UI + bridge from one command, opening the browser.

- [ ] **Step 1: Implement cli.ts**

`apps/bridge/src/cli.ts`:
```ts
#!/usr/bin/env bun
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { EventLog } from "./store/event-log";
import { SessionWatcher } from "./watcher/session-watcher";
import { createServer } from "./server";

const root = join(homedir(), ".claude", "projects");
const uiDir = process.env.FLEETVIEW_UI_DIR ?? resolve(import.meta.dir, "../../ui/dist");
const port = Number(process.env.PORT ?? 4317);
const log = new EventLog(join(homedir(), ".fleetview.sqlite"));
const watcher = new SessionWatcher(root, log);
watcher.start(750);
void watcher.scanOnce();
const srv = createServer({ log, watcher, uiDir, port });
const url = `http://localhost:${srv.port}`;
console.log(`FleetView running at ${url}`);
try { Bun.spawn(["xdg-open", url]); } catch { /* headless ok */ }
```

- [ ] **Step 2: Add bin + build script**

In `apps/bridge/package.json` add:
```json
"bin": { "fleetview": "src/cli.ts" }
```

`scripts/build-all.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
bun install
( cd apps/ui && bunx vite build )
echo "Built. Run: bun run apps/bridge/src/cli.ts"
```

- [ ] **Step 3: Smoke test the command**

Run:
```bash
chmod +x scripts/build-all.sh && ./scripts/build-all.sh
bun run apps/bridge/src/cli.ts
```
Expected: prints "FleetView running at http://localhost:4317"; the page loads and lists real sessions.

- [ ] **Step 4: Commit**

```bash
git add apps/bridge/src/cli.ts apps/bridge/package.json scripts/build-all.sh
git commit -m "feat: one-command fleetview launcher serving bridge and UI"
```

---

## Self-Review

**Spec coverage (§5 v1 features):**
1. One-command start → Task 14. ✓
2. Sessions sidebar with status pips → Task 10. ✓
3. Launch & drive → **Plan 2** (out of scope here; observe-first). Noted.
4. Attach & observe → Tasks 3–7, 13. ✓
5. Colony tree (hero) → Task 11. ✓
6. Node inspector → Task 12. ✓
7. Activity feed → Task 13. ✓
8. Permission prompts → **Plan 2**. Noted (needs drive path).
9. Plan & todos → **Plan 2** (depends on spike + drive). Noted.
10. Workflow lens → **Plan 2** (tree clustering builds on observe tree). Noted.
11. Skills / hooks / MCP badges → **Plan 2** (event kinds present in contract can be extended; observe path emits tool_call now). Noted.
12. Reconnect replay → Tasks 5 + 7 (backlog replay on subscribe). ✓

Architecture (§4) units 1–7 map to Tasks 3 (tail/discover), 4 (normalize), 5 (store), 6 (watcher), 7 (ws), 9 (ui store), 11 (tree). ✓
Testing (§9): protocol/normalize unit + fixture tests (Tasks 2, 4), bridge integration (Tasks 6, 7), ui reducer (Task 9), components (Tasks 10, 12, 13). ✓
Risk (§7): spike is Task 0 and gates field assumptions. Observe-first is exactly this plan. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Each code step shows complete code. ✓

**Type consistency:** `SessionEvent` kinds and fields used in Tasks 4, 9, 12, 13 match the contract in Task 2 (`subagent_spawn.label`, `tool_call.{callId,tool,target}`, `tool_result.{callId,ok,summary}`, `token_usage.{inTokens,outTokens}`). `AgentNode` fields (`agentId`, `parentAgentId`, `label`, `status`, `tokens`, `tools`) consistent across Tasks 9, 11, 12. `layout()` / `PositionedNode` consistent between Tasks 11 definition and usage. `EventLog.since/append/sessions` consistent across Tasks 5, 7. ✓

**Deferred features (3, 8–11) are intentionally Plan 2** — this plan delivers a complete, demoable observe-only product, matching the spec's observe-first decision.

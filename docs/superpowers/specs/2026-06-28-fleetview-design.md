# FleetView — Design Spec

**Date:** 2026-06-28
**Status:** Approved design, ready for implementation planning
**Working name:** FleetView (a fleet of agents, one view)

## 1. Summary

FleetView is a local-first web app that multiplexes Claude Code sessions and gives
first-class, motion-rich visualization of everything happening inside them — main
agents, subagents, workflow sub-agents, tool calls, skills, hooks, MCP calls,
permission prompts, plan mode, and todos.

The user reuses their existing Claude Code CLI authentication (their subscription).
There is no separate API key, no account, no cloud. One command starts a local
bridge and serves the UI at localhost.

The signature experience is a **live "colony" tree**: the main session is a root
node; subagents and workflow sub-agents bloom outward as living nodes; edges pulse
with flowing particles as tokens move; node color encodes status. The visual system
is **organic motion (the colony) rendered in a warm editorial "atelier" theme**
(cream paper, clay/sage/ink, Fraunces display serif) — deliberately not a dark HUD.

## 2. Goals & non-goals

### Goals
- Reuse the user's CLI auth; zero extra credentials.
- One unified view for both **driven** sessions (started/controlled from the app)
  and **attached** sessions (started in a terminal, observed).
- First-class UI for native Claude Code features: subagents, workflows, permission
  prompts, plan mode, todos, skills, hooks, MCP.
- Award-caliber, motion-heavy UI/UX that is distinctive, not templated.
- Truly lightweight: local single-user, minimal dependencies, fast start.

### Non-goals (deferred post-v1)
- Multi-user / hosted / team deployment, accounts, sandboxing.
- Diff-based approval UI, session recording/playback scrubber.
- Cross-session search, mobile layout, multiplex grid view.

## 3. Users & deployment

Single user, local machine. Started via `npx fleetview` (or a dev script), which
boots the bridge and serves the UI at `localhost`. Uses the user's existing
`claude` CLI authentication. No accounts, no cloud, local persistence only.

## 4. Architecture

Two processes on the user's machine, one command, one canonical event model.

```
React + Vite UI  ◄──── WebSocket ────►  Bridge (Bun)
(localhost)        events + commands       │
                                           ├─ spawns `claude` headless
                                           │   (--print --output-format stream-json,
                                           │    --input-format stream-json) for DRIVEN sessions
                                           ├─ tails ~/.claude/projects/**/*.jsonl
                                           │   for ATTACHED (terminal) sessions
                                           ├─ normalizes BOTH into canonical SessionEvent
                                           ├─ persists an event log (bun:sqlite) for replay
                                           └─ uses the user's existing CLI auth
```

### Key idea: one canonical event model

Both ingestion paths normalize into a single `SessionEvent` stream. The UI never
knows or cares which source an event came from — it renders the normalized tree.
This boundary is what keeps "both driven and attached" from doubling UI work.

`SessionEvent` (illustrative — finalized in `packages/protocol`):
`message` · `tool_call` · `tool_result` · `subagent_spawn` · `subagent_exit` ·
`workflow_phase` · `permission_request` · `permission_resolved` · `todo_update` ·
`plan_proposed` · `skill_activated` · `hook_fired` · `mcp_call` · `token_usage` ·
`session_status`. Every event carries `sessionId`, `agentId`, `parentAgentId`,
and a monotonic sequence number for ordering and replay.

### Units (each independently testable)

1. `bridge/spawn` — process lifecycle + stdin/stdout stream-json codec (driven).
2. `bridge/tail` — transcript file watcher → raw events (attached).
3. `bridge/normalize` — both raw sources → canonical `SessionEvent` (pure, heavily tested).
4. `bridge/ws` — WebSocket protocol: subscribe, send-prompt, approve/deny, replay.
5. `bridge/store` — `bun:sqlite` event log + replay on reconnect.
6. `ui/store` — client event store; reduces events → session + agent-tree state.
7. `ui/tree` — the colony tree canvas renderer.
8. `ui/*` — shell, sidebar, inspector, launcher, feed, permission cards, panels.

## 5. Feature scope (v1)

1. **One-command start** — boot bridge + serve UI at localhost using CLI auth.
2. **Sessions sidebar** — all sessions with live status pips (working / waiting / idle).
3. **Launch & drive** — new-session launcher (folder, first prompt, model, permission
   mode, optional "start in" skills/plan mode); send follow-up prompts via a composer.
4. **Attach & observe** — auto-discovered terminal sessions from transcripts, read-only.
5. **Colony tree (hero)** — main + subagents + workflow sub-agents as live blooming
   nodes; pulsing particle edges; status color; click a node to inspect.
6. **Node inspector** — per-agent transcript: messages, nested tool cards
   (name + target + result/diff), skill badges, token/tool stats, tree breadcrumb.
7. **Activity feed** — the normalized event stream for the active session.
8. **Permission prompts** — interactive Allow/Deny cards (driven sessions; see §7 risk).
9. **Plan & todos** — plan-mode proposals + live animated todo checklist.
10. **Workflow lens** — workflow runs shown **on the colony tree**: a phase is a
    labeled cluster; parallel/pipeline agents bloom as siblings. No separate view.
11. **Skills / hooks / MCP** — badges on nodes and in the feed.
12. **Reconnect replay** — event log restores full state on refresh/reconnect.

## 6. Visual design system (A × C)

- **Concept:** the colony — a living, branching organism of agents — drawn in ink
  on warm paper. Organic motion meets editorial calm.
- **Palette:** cream `#F4F1EA`, paper `#FFFFFF`, ink `#1A1714`, clay `#C96442`
  (primary accent / "waiting on you"), sage `#7C8B6F` ("working"), slate `#3D4A52`,
  hairline `#DCD5C6`, muted `#8C8475`, idle `#C3BBA9`.
- **Type:** Fraunces (display serif, used with restraint) · Inter (body) ·
  JetBrains Mono (data/labels/code).
- **Status semantics:** sage = working, clay = waiting on you, idle = neutral.
- **Signature element:** the colony tree — white-disc nodes with ink/clay/sage
  rings, breathing halos, a pulsing core for active agents, and clay/sage particles
  flowing along quadratic ink edges. Everything else stays quiet so the tree is the
  one memorable thing.
- **Motion:** Motion (`motion/react`) for spring-based panel/layout transitions and
  micro-interactions; canvas requestAnimationFrame for the organism. Respect
  `prefers-reduced-motion` (freeze particles/halos, keep state legible). Keyboard
  focus visible; responsive down to small windows.

Reference mockups produced during design (colony×atelier): main colony view,
new-session launcher, node inspector.

## 7. Risks & de-risking

The single biggest unknown is the exact `claude` headless event surface. Two
specific questions, resolved by a **spike before any UI work**:

1. **Attribution** — does `claude --output-format stream-json` emit distinct,
   attributable **subagent** and **workflow** events (so we can place tree nodes
   precisely), or must structure be inferred from the transcript?
2. **Permissions** — do permission prompts surface in headless mode in a way we can
   intercept and answer from the UI (e.g. `--permission-prompt-tool`), or not?

**Fallback (decided): observe-first.** If driving/permissions prove limited, ship
the rich observe/visualize experience first — it works via transcripts for *all*
sessions — and add full drive + approve as a fast-follow once the mechanism is
confirmed. This de-risks the whole project and keeps every milestone demoable.

## 8. Tech stack

- **UI:** React 19, Vite, TypeScript, Tailwind v4, shadcn/ui (Radix) for chrome
  (modals, tabs, drawers), Motion for transitions, HTML canvas for the colony tree.
- **Bridge:** Bun server — process spawning, transcript tailing, normalization,
  WebSocket, `bun:sqlite` event log.
- **Monorepo:** `apps/ui`, `apps/bridge`, `packages/protocol` (shared `SessionEvent`
  contract both sides test against).

## 9. Testing strategy

- `packages/protocol` + `bridge/normalize` — heavy unit tests; pure functions
  (raw stream-json / JSONL → `SessionEvent`). The correctness core.
- `bridge/spawn` + `bridge/tail` — integration tests against **recorded fixture
  streams** (capture real `claude` output once, replay in CI; no live API needed).
- `ui/store` — reducer unit tests (events → tree/session state).
- UI — Vitest + Testing Library for components; one Playwright smoke test driving a
  mock bridge.

## 10. Build order

0. **Spike** (gate) — capture real `claude --output-format stream-json` output;
   confirm subagent/workflow/permission events. Decides observe-first vs full-drive depth.
1. `packages/protocol` — the `SessionEvent` contract.
2. `bridge` observe path — tail transcripts → normalized events → WS (works for all
   sessions immediately).
3. `ui` shell + colony tree + activity feed + node inspector (observe-only, end to end).
4. `bridge` drive path — spawn, prompt composer, launcher.
5. Permission cards, plan/todos, workflow clusters, skill/hook/MCP badges.
6. Reconnect replay + polish (motion, reduced-motion, responsive).

Each step ends in a working, demoable app.

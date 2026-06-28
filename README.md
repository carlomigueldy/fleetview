<div align="center">

```
   ███████╗██╗     ███████╗███████╗████████╗██╗   ██╗██╗███████╗██╗    ██╗
   ██╔════╝██║     ██╔════╝██╔════╝╚══██╔══╝██║   ██║██║██╔════╝██║    ██║
   █████╗  ██║     █████╗  █████╗     ██║   ██║   ██║██║█████╗  ██║ █╗ ██║
   ██╔══╝  ██║     ██╔══╝  ██╔══╝     ██║   ╚██╗ ██╔╝██║██╔══╝  ██║███╗██║
   ██║     ███████╗███████╗███████╗   ██║    ╚████╔╝ ██║███████╗╚███╔███╔╝
   ╚═╝     ╚══════╝╚══════╝╚══════╝   ╚═╝     ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝
```

**Multiplex & visualize your Claude Code sessions — a living *colony* of agents, in real time.**

*Local-first · reuses your existing CLI auth · no accounts, no cloud, no API key*

</div>

---

## What is this?

FleetView watches your Claude Code sessions and renders everything happening inside
them — main agents, subagents, workflow sub-agents, tool calls, skills, hooks, MCP
calls — as a **live, breathing colony tree**. One root, branches blooming outward as
work fans out, edges pulsing as tokens flow.

It runs entirely on your machine. A tiny local bridge tails the transcript files
Claude Code already writes, normalizes them into one canonical event stream, and
serves it to a motion-rich web UI. You just open a browser.

```
                          ·  write-test
                           \
            explore         ·  tdd-impl
                 \         /        \
                  \       /          ·  impl
            plan ·──────·  main
                        /  \
                       /    \
              review ·       · ( your whole session, alive )

        ● working     ◐ waiting on you     ○ idle
```

## Features (Observe MVP)

- **Sessions sidebar** — every session, by project, with live status pips.
- **Colony tree** — the signature view: subagents and workflow branches bloom from
  one root; nodes breathe, edges flow.
- **Node inspector** — click any agent to see its transcript, tool calls, skills,
  and token/tool stats.
- **Activity feed** — the normalized event stream, newest first.
- **Reconnect replay** — refresh and your view is restored from a local event log.

> Driving sessions from the app (launch, prompt, approve permissions, plan/todo &
> workflow lenses) is the next milestone — see `docs/superpowers/`.

## Architecture

Two processes on your machine, one command, one canonical event model.

```
   React + Vite UI  ◄──── WebSocket ────►  Bridge (Bun)
   (localhost)          events + replay        │
                                               ├─ tails ~/.claude/projects/**/*.jsonl
                                               ├─ normalizes → canonical SessionEvent
                                               ├─ event log (bun:sqlite) for replay
                                               └─ binds 127.0.0.1 only · WS origin allowlist
```

The UI never knows whether an event came from a driven or an attached session — both
sources normalize into one `SessionEvent` stream, so the colony tree is source-blind.

## Quick start

```bash
bun install
( cd apps/ui && bunx vite build )
bun run apps/bridge/src/cli.ts        # opens http://localhost:4317
```

For development with hot-reload:

```bash
# terminal 1 — bridge
PORT=4317 FLEETVIEW_DEV_ORIGIN=http://localhost:5174 bun run apps/bridge/src/main.ts
# terminal 2 — UI
cd apps/ui && bunx vite --port 5174
```

## Security

This is a single-user local tool, and it treats your transcripts as sensitive:

- The bridge **binds to `127.0.0.1` only** — never the LAN.
- WebSocket upgrades are checked against an **Origin allowlist** (anti-CSWSH).
- Inbound frames are parsed defensively and shape-validated.

## Tech stack

`Bun` · `React 19` · `Vite` · `TypeScript` · `Tailwind v4` · `shadcn/ui` · `Motion` ·
HTML canvas · `bun:sqlite` · `Zod` · `Vitest` / `bun test`

## Project layout

```
apps/
  bridge/      Bun server: discover · tail · normalize · event-log · websocket
  ui/          React app: store · colony tree · inspector · feed
packages/
  protocol/    the shared SessionEvent contract
docs/
  superpowers/ design spec, implementation plan, mockups
```

## Status

**Observe MVP** — built test-first (protocol + bridge + UI all green), verified
against real sessions. Built with a multi-agent harness: parallel implementation,
adversarial 10/10 review, and fix loops.

---

<div align="center"><sub>Built for watching agents think.</sub></div>

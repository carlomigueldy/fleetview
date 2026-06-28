# Spike: Claude Code Transcript Format

**Date:** 2026-06-28  
**Status:** Complete  
**Scope:** Characterize ~/.claude/projects JSONL transcript format for FleetView bridge implementation (Task 3/4 of Plan 1).

---

## 1. Storage Layout (Two Formats)

### 1a. Flat format (single-agent sessions)
```
~/.claude/projects/{slug}/{session-uuid}.jsonl
```
All conversation turns interleaved in one file. This is the standard format when no subagents or workflows are spawned.

### 1b. Directory format (sessions with subagents / workflows)
```
~/.claude/projects/{slug}/{session-uuid}.jsonl          # main agent transcript (same UUID)
~/.claude/projects/{slug}/{session-uuid}/
  subagents/
    agent-{agentId}.jsonl                               # standalone subagent transcripts
    agent-{agentId}.meta.json                           # subagent metadata
    workflows/
      {wf-id}/
        agent-{agentId}.jsonl                           # workflow subagent transcripts
        agent-{agentId}.meta.json
        journal.jsonl                                   # which agents started which phase
  workflows/
    {wf-id}.json                                        # workflow definition/result
  tool-results/
    {id}.txt                                            # large tool output files
```

When subagents are spawned, a sibling directory is created alongside the main `.jsonl` file with the same session UUID. The main agent transcript always remains the `.jsonl` file at the project level.

---

## 2. Top-Level Fields Per JSONL Line

Every line is a self-contained JSON object. Fields observed across real transcripts:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uuid` | string | yes (most types) | Unique ID for this entry |
| `parentUuid` | string \| null | yes (most types) | Links to prior entry in the turn chain |
| `type` | string | yes | Entry class (see §3) |
| `isSidechain` | boolean | yes (conversation types) | `true` for subagent entries |
| `agentId` | string | when `isSidechain:true` | Hex ID of the subagent (e.g. `a3x9bf2c1d0e7f4a8`) |
| `sessionId` | string | yes | Session UUID, same across all entries in a session |
| `timestamp` | string | most types | ISO 8601 datetime |
| `cwd` | string | conversation types | Working directory at time of entry |
| `message` | object | user/assistant types | The message payload (see §4) |
| `version` | string | conversation types | Claude CLI version (e.g. `2.1.185`) |
| `gitBranch` | string | optional | Active git branch |
| `permissionMode` | string | user (first entry) | e.g. `"default"`, `"auto"` |
| `promptId` | string | user entries | Groups tool_results to their originating prompt |
| `promptSource` | string | first user entry | `"human"`, `"sdk"` |
| `entrypoint` | string | conversation types | `"cli"`, `"sdk-py"` |
| `userType` | string | conversation types | e.g. `"external"` |
| `requestId` | string | assistant entries | Request trace ID |
| `toolUseResult` | string or object | user entries with tool_result | The raw tool output (may be large — referenced via tool-results/ file) |
| `sourceToolAssistantUUID` | string | user entries with tool_result | UUID of the assistant entry that emitted the tool_use |
| `attachment` | object | `type:"attachment"` entries | Deferred-tool deltas, agent-listing deltas |
| `attributionAgent` | string | subagent/workflow entries | Role/type of the agent: observed `"Explore"` on a direct Agent subagent; `"workflow-subagent"` reported but **not verified in captured fixtures** — see §5b |
| `attributionSkill` | string | skill-spawned sessions | Name of the skill that launched this agent (e.g. `"orchestrator"`) |
| `workflowId` | string | workflow sidechain entries | ID of the parent workflow run (e.g. `"wf_f1cc3383-330"`); present on all entries in workflow subagent files |
| `workflowPhase` | string | workflow sidechain entries | Name of the workflow phase this agent is executing (e.g. `"visual-review"`); present inline on each sidechain entry — phase is **directly readable** from the transcript without consulting `wf.json` |
| `slug` | string | bridge-session entries | Human-readable project slug (e.g. `"fuzzy-marinating-taco"`) |
| `bridgeSessionId` | string | bridge-session entries | Bridge correlation ID (e.g. `"cse_014eEtWK..."`) |
| `lastSequenceNum` | number | bridge-session entries | Monotonic counter for bridge-session entries |
| `key` | string | some entries | Versioned hash key (e.g. `"v2:<sha256>"`) used internally by the CLI |

### Example: simple user entry
```json
{
  "parentUuid": null,
  "isSidechain": false,
  "promptId": "prompt-0001",
  "type": "user",
  "message": {"role": "user", "content": "List the files in src/"},
  "uuid": "a1b2c3d4-...",
  "timestamp": "2026-06-28T10:00:00.000Z",
  "permissionMode": "default",
  "promptSource": "human",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/home/user/project",
  "sessionId": "sess-simple-0001",
  "version": "2.1.185",
  "gitBranch": "main"
}
```

---

## 3. Entry `type` Values

| type | Description |
|------|-------------|
| `"user"` | Human or tool-result message |
| `"assistant"` | Model response (may span multiple entries per response when content blocks are split) |
| `"attachment"` | Metadata delta (deferred tools list, agent listing) |
| `"last-prompt"` | Pointer to the leaf UUID of the last human prompt (used for resume) |
| `"mode"` | Session mode (e.g. normal, auto) |
| `"permission-mode"` | Permission mode record |
| `"worktree-state"` | Git worktree state snapshot |
| `"bridge-session"` | Bridge metadata |
| `"file-history-snapshot"` | File state snapshot |
| `"ai-title"` | Auto-generated session title (has `aiTitle` field, no `uuid`) |
| `"queue-operation"` | Task-queue enqueue/dequeue records (SDK sessions) |

**Critical:** A single API response may be split across **two** consecutive `"assistant"` entries sharing the same `message.id` — typically one entry for the `thinking` block and a second for the `tool_use` or `text` blocks. Both entries have the same `message.usage`.

---

## 4. Message Content Blocks (`message.content`)

`message.content` is either a string (user text) or an array of typed blocks.

### Text block
```json
{"type": "text", "text": "The auth module uses JWT..."}
```

### Thinking block (extended thinking enabled)
```json
{"type": "thinking", "thinking": "I should read the file first.", "signature": "AAAA..."}
```

### Tool use block (assistant invoking a tool)
```json
{
  "type": "tool_use",
  "id": "toolu_01Et2...",
  "name": "Bash",
  "input": {"command": "ls src/"},
  "caller": {"type": "direct"}
}
```

### Tool result block (user returning a tool result)
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01Et2...",
  "content": "index.ts\nutils.ts\ntypes.ts",
  "is_error": false
}
```
`content` may be a string or an array of typed sub-blocks (e.g. `[{"type":"text","text":"..."}]`).

### Message-level usage (token counts)
Present on every assistant `message` object:
```json
{
  "usage": {
    "input_tokens": 120,
    "cache_creation_input_tokens": 32288,
    "cache_read_input_tokens": 0,
    "output_tokens": 85
  },
  "stop_reason": "tool_use"
}
```
`stop_reason` is `"tool_use"` when calling a tool, `"end_turn"` when finishing.

---

## 5. Subagent Spawn Pattern

### 5a. How the main agent spawns a subagent or workflow

The orchestrating agent uses one of three tools:

**`Agent` tool** (direct subagent spawn, immediate execution — observed 12×):
```json
{
  "type": "tool_use",
  "id": "toolu_017QuRyVnTGeLQmNNRGHSKh6",
  "name": "Agent",
  "input": {
    "description": "Scout session init context",
    "model": "sonnet",
    "prompt": "You are a scouting agent orienting a new session...",
    "subagent_type": "Explore"
  },
  "caller": {"type": "direct"}
}
```
Real `Agent` input keys are `description`, `model`, `prompt`, `subagent_type` — there is **no `name` key** in the input. The `model` field carries a short alias such as `"sonnet"` or `"opus"`. The example above is captured from `subagent-session.jsonl` (real transcript, anonymized).

Result entry is a `tool_result` with the subagent's completed output and metadata including `agentId`, `agentType`, `resolvedModel`, `totalDurationMs`, and `totalTokens`.

**`Workflow` tool** (multi-phase workflow spawn — observed 12× in real transcripts, as frequent as `Agent`):
```json
{
  "type": "tool_use",
  "id": "toolu_01P8UQ2717cpc5V6cMEAk4XS",
  "name": "Workflow",
  "input": {
    "scriptPath": "/tmp/ui-ux-workflow.js"
  },
  "caller": {"type": "direct"}
}
```
The `Workflow` tool_use has a **single input key `scriptPath`** — the path to a pre-compiled JS workflow script. This is captured from `workflow-session.jsonl`. The result is a `tool_result` containing an async-launched ack:
```json
{
  "status": "async_launched",
  "taskId": "w6z0imajs",
  "taskType": "local_workflow",
  "workflowName": "ui-ux-polish",
  "runId": "wf_f1cc3383-330",
  "transcriptDir": "/home/user/.claude/projects/.../{session-uuid}/subagents/workflows/wf_f1cc3383-330",
  "scriptPath": "/tmp/ui-ux-workflow.js"
}
```
The `tool_result` content string is: `"Workflow launched in background. Task ID: {taskId}\nSummary: ..."`. The `toolUseResult` top-level field on the user entry carries the structured ack object. Workflow subagents write to `{session-uuid}/subagents/workflows/{wf-id}/agent-{id}.jsonl` — separate files, same pattern as direct Agent subagents.

**`TaskCreate` tool** (deferred/queued task — observed in SDK/queue sessions):
```json
{
  "type": "tool_use",
  "id": "toolu_EEE_tc01",
  "name": "TaskCreate",
  "input": {
    "subject": "Run code-review workflow",
    "description": "Phase 1: reviewers; Phase 2: consolidate; Phase 3: fix",
    "activeForm": "Running code-review workflow"
  }
}
```
Result is `"Task #N created successfully: {subject}"`.

> **Plan adjustment for Task 4 (normalize.ts):** The plan's `normalize.ts` tests for `name === "Task"` (a single-word tool name). Real data shows the tool is named **`"Agent"`** (direct subagent spawn), **`"Workflow"`** (multi-phase workflow), or **`"TaskCreate"`** (queued). Update the `subagent_spawn` detection to match all three: `"Agent"`, `"Workflow"`, and `"TaskCreate"`.

### 5b. How subagent entries link back

Subagent entries in the `.jsonl` always have:
- `isSidechain: true`
- `agentId: "{hex-string}"` — e.g. `"a3x9bf2c1d0e7f4a8"`

The `agentId` hex value matches the filename stem in the directory format (`agent-a3x9bf2c1d0e7f4a8.jsonl`). The `meta.json` sidecar contains `toolUseId` which links back to the spawning `tool_use.id` in the main transcript.

Sidechain entries always live in a separate file under the directory-format path (`{session-uuid}/subagents/agent-{agentId}.jsonl`). They are never interspersed in the main `.jsonl`. Grep across all 1383 real transcripts confirms `"isSidechain":true` entries appear exclusively in files under `subagents/` paths — never in the top-level session `.jsonl`.

### 5c. Parent chain resolution

Subagent entries use `parentUuid` to form a linear chain within their own sidechain. The `parentUuid` of the first sidechain entry is `null`. The `sessionId` is always the **parent session's** UUID (not the subagent's own ID), so `sessionId` + `agentId` together uniquely identify an agent thread.

**`attributionAgent` as a type signal:** This field carries the subagent's role/type. The captured fixture (`subagent-session/subagents/agent-ae646fa4217c97fe7.jsonl`) shows `attributionAgent: "Explore"` on a direct `Agent` subagent — the value matches the `subagent_type` input key. The value `"workflow-subagent"` is reported in the plan assumptions but is **not confirmed in any captured fixture**; treat it as unverified. The field does not encode a parent agent ID. For building the `parentAgentId` field in `SessionEvent`, the primary signals remain `isSidechain`/`agentId` (sidechain linkage) plus the `meta.json` `toolUseId` that links back to the spawning `tool_use.id`. `attributionAgent` is most useful for classifying agent type in the event stream rather than establishing the parent chain.

---

## 6. Workflow Sessions

Workflows are spawned via the **`Workflow`** tool (see §5a). The `Workflow` tool_use appears in the main agent's transcript exactly like any other tool_use block, with `name: "Workflow"` and a **single input key `scriptPath`** (the path to a pre-compiled JS workflow script on disk). The result is an async-launched ack: the `tool_result` content string is `"Workflow launched in background. Task ID: {taskId}\nSummary: ..."`, and the `toolUseResult` field on the user entry carries a structured object with `status: "async_launched"`, `taskId`, `runId`, `workflowName`, and `transcriptDir`. The associated `TaskUpdate`, `TaskOutput`, and `TaskList` tool calls may also appear in main-agent entries as the workflow progresses.

When a workflow runs, the `workflows/{wf-id}.json` file records:
- `runId`, `timestamp`, `taskId`
- `phases: [{title, detail}]` — named phases of the workflow
- `agentCount` — total agents spawned
- `status` — `"complete"` | `"killed"` | `"running"`
- `durationMs`, `error`, `logs`, `summary`

Workflow subagents have `meta.json` with `agentType: "workflow-subagent"`. The `subagents/workflows/{wf-id}/journal.jsonl` records `{type:"started", key, agentId}` for each agent as it begins.

Workflow phases **are** directly distinguishable from the transcript: every sidechain entry in a workflow subagent file carries `workflowPhase` (e.g. `"visual-review"`) and `workflowId` inline. No external `wf.json` lookup is needed to identify the phase. The `workflows/{wf-id}.json` file provides supplementary metadata (phase list, agent count, status, duration) but the phase name itself is present on each transcript entry. Agents within a workflow are identifiable by their path: `subagents/workflows/{wf-id}/agent-{id}.jsonl`.

---

## 7. Session Active vs Done Inference

There is **no explicit terminal entry** that marks a session as complete. To infer status:

| Signal | Inference |
|--------|-----------|
| `last-prompt` type entry | The session was at some point paused/resumed (not terminal) |
| Last assistant entry has `stop_reason: "end_turn"` | Session completed cleanly |
| Last assistant entry has `stop_reason: "tool_use"` and no following `tool_result` | Session is still running or crashed mid-tool |
| File `mtime` older than 5–10 minutes | Likely idle/done |
| No new lines appended on successive polls | Session is done |

The most reliable approach for FleetView: poll `mtime` and track whether new entries appear on each scan cycle.

---

## 8. Fixture Notes

| Fixture | Source | Lines | Sequence |
|---------|--------|-------|----------|
| `simple-session.jsonl` | **Captured** from `~/.claude/projects/-home-carlomigueldy-cryptbound/a1f42504-e9ea-4a8b-be5a-fd02d6ffc88b.jsonl` (SDK security-review session, 2026-06-19). Paths anonymized (`/home/user/project`). | 6 | queue-operation (enqueue), user (SDK prompt), assistant (thinking, split entry), assistant (StructuredOutput tool_use, same msg id), user (tool_result ack), assistant (text, end_turn) |
| `subagent-session.jsonl` (main) | **Captured** from `~/.claude/projects/-home-carlomigueldy-raidlings--claude-worktrees-feat-character-abilities/a19455d2-60c1-4032-a011-6ed34b11176a.jsonl` (2026-06-18). Paths/content anonymized. Subagent entries are **NOT** in this file — they live in the companion directory (see below). | 3 | assistant (thinking), assistant (Agent tool_use — 4 input keys: description/model/prompt/subagent_type), user (spawn ack with agentId + truncated briefing) |
| `subagent-session/subagents/agent-ae646fa4217c97fe7.jsonl` | **Captured** from same session's `subagents/` directory. First line has `parentUuid:null`, `isSidechain:true`, `agentId:"ae646fa4217c97fe7"`. Links back to main session via shared `sessionId`. | 5 | user (parentUuid:null, prompt), attachment (deferred tools), assistant (thinking), assistant (Bash tool_use), user (tool_result) |
| `workflow-session.jsonl` | **Captured** from `~/.claude/projects/-home-carlomigueldy-senior-portfolio--claude-worktrees-chore-polish-ui-ux/662bb89c-7f07-44b3-b2c3-498735ca1332.jsonl` (2026-06-20). Paths anonymized. Workflow subagents live in `subagents/workflows/wf_f1cc3383-330/` (separate files, not in this fixture). Real Workflow input key is `scriptPath` (path to a compiled JS file), not `script`+`args` as the plan assumed. | 3 | assistant (text "launching"), assistant (Workflow tool_use — `scriptPath` key), user (async_launched ack with taskId/runId/transcriptDir) |
| `workflow-session/subagents/workflows/wf_f1cc3383-330/agent-b7d92e1a4f3c08e52.jsonl` | **SYNTHETIC** — no real workflow-subagent transcript was available for capture. Fabricated to illustrate `workflowId`/`workflowPhase` inline fields and the sidechain structure within a workflow directory. UUIDs are sequential placeholders (`a1b2c3d4-e5f6-...`), not real. Use this file only as a structural reference; do not treat it as confirmed behavior. | 5 | user (parentUuid:null, phase prompt with workflowId+workflowPhase), assistant (thinking, split), assistant (Bash tool_use, split), user (tool_result), assistant (findings text, end_turn) |

All fixtures under `simple-session.jsonl`, `subagent-session.jsonl`, and `subagent-session/subagents/` are **captured** from real transcripts with absolute paths anonymized to `/home/user/project`; their UUIDs, session IDs, and request IDs are real (not fabricated). The `workflow-session/subagents/workflows/` fixture is **SYNTHETIC** (see table row above) and its UUIDs are illustrative placeholders. Prompts and content are excerpted and truncated where noted.

---

## 9. Key Deviations From Plan Assumptions

| Plan assumption (Tasks 3/4) | Reality |
|-----------------------------|---------|
| `type === "Task"` tool name | Real tool names are `"Agent"` (direct subagent), **`"Workflow"`** (multi-phase workflow — as frequent as `Agent`, 12× each), and `"TaskCreate"` (queued/SDK). The `Workflow` tool was entirely unaccounted for in the original plan. |
| Sidechain entries mixed into single main `.jsonl` | **Directory format only**: sidechain entries always live in separate `subagents/agent-{id}.jsonl` files, never in the main `.jsonl`. There is no flat single-file variant with interspersed sidechain entries. |
| `message.content` always an array | Can also be a plain string for simple user messages |
| No `agentId` field | `agentId` is present on sidechain entries and identifies the subagent |
| Single assistant entry per response | Responses split into 2 entries when thinking+tool_use (same `message.id`) |
| No `attributionAgent` field | `attributionAgent` appears on subagent entries carrying the agent's role/type. Captured fixture shows value `"Explore"` (matching `subagent_type`) on a direct Agent subagent. Value `"workflow-subagent"` is plan-reported but **unverified in captured fixtures**. Also `attributionSkill`, `slug`, `bridgeSessionId`, `lastSequenceNum`, `key` appear in real transcripts. |
| `Agent` input has a `name` key | Real `Agent` input has four keys — `description`, `model`, `prompt`, `subagent_type` — no `name` key. The `model` key (e.g. `"sonnet"`) was absent from the original plan assumptions. |

| `Workflow` input has `script`+`args` keys | Real input uses **`scriptPath`** (path to a pre-compiled JS file). The result is an async-launched ack with `taskId`, `runId`, `workflowName`, and `transcriptDir`. |

These deviations should be reflected in `read.ts` (add `agentId`, `attributionAgent` to `RawEntry`) and `normalize.ts` (match `"Agent"`, `"Workflow"`, and `"TaskCreate"` not `"Task"`). Also note: subagent linkage must use `agentId` from the sidechain file (not an intra-file parentUuid chain), cross-referenced with the spawning `tool_use.id` via `meta.json`.

import { render, screen } from "@testing-library/react";
import { NodeInspector, friendlyModelName } from "./NodeInspector";
import { emptyState, reduce } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";

const e = (p: any): SessionEvent => ({ sessionId: "s1", agentId: "a2", parentAgentId: "main", seq: 0, ts: 0, ...p });

test("shows the agent transcript text and a tool card", () => {
  // reduce() updates agents/lastSeq but does NOT accumulate events (the caller
  // does that in one batch to avoid O(K²) spreading — see useSession.ts).
  // Here we simulate the caller's responsibility by setting events explicitly.
  let s = emptyState();
  const evs = [
    e({ kind: "subagent_spawn", label: "explore", seq: 1 }),
    e({ kind: "message", role: "assistant", text: "reading files", seq: 2 }),
    e({ kind: "tool_call", callId: "c1", tool: "Read", target: "/a.ts", seq: 3 }),
  ];
  for (const ev of evs) s = reduce(s, ev);
  s = { ...s, events: evs }; // caller sets events (mirrors useSession batch pattern)
  render(<NodeInspector state={s} agentId="a2" onClose={() => {}} />);
  expect(screen.getByText("reading files")).toBeInTheDocument();
  expect(screen.getByText("Read")).toBeInTheDocument();
});

test("renders nothing when no agent selected", () => {
  const { container } = render(<NodeInspector state={emptyState()} agentId={null} onClose={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

// ── friendlyModelName unit tests ────────────────────────────────────────────────

test("friendlyModelName maps claude-opus-4-8 → Opus 4.8", () => {
  expect(friendlyModelName("claude-opus-4-8")).toBe("Opus 4.8");
});

test("friendlyModelName maps claude-sonnet-4-6 → Sonnet 4.6", () => {
  expect(friendlyModelName("claude-sonnet-4-6")).toBe("Sonnet 4.6");
});

test("friendlyModelName maps claude-haiku-3-5 → Haiku 3.5", () => {
  expect(friendlyModelName("claude-haiku-3-5")).toBe("Haiku 3.5");
});

test("friendlyModelName falls back to raw id for unrecognised models", () => {
  expect(friendlyModelName("gpt-4o")).toBe("gpt-4o");
});

test("friendlyModelName returns '–' for undefined", () => {
  expect(friendlyModelName(undefined)).toBe("–");
});

test("inspector istats renders friendly model name", () => {
  // Set up state where the main agent has a model string.
  let s = emptyState();
  const evs: SessionEvent[] = [
    { sessionId: "s1", agentId: "main", parentAgentId: null, seq: 0, ts: 0, kind: "token_usage", inTokens: 10, outTokens: 5, model: "claude-opus-4-8" },
  ];
  for (const ev of evs) s = reduce(s, ev);
  s = { ...s, events: evs };
  render(<NodeInspector state={s} agentId="main" onClose={() => {}} />);
  // Should show the friendly name, not the raw id.
  expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
});

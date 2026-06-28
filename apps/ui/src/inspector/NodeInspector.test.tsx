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

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

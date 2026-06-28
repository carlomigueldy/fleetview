import { selectAgentEvents } from "./select-agent-events";
import { emptyState, reduce } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";

const e = (p: Partial<SessionEvent> & Pick<SessionEvent, "kind">): SessionEvent => ({ sessionId: "s1", agentId: "main", parentAgentId: null, seq: 0, ts: 0, ...(p as any) });

test("returns only the selected agent's events", () => {
  // reduce() updates agents/lastSeq but does NOT accumulate events (the caller
  // does that in one batch to avoid O(K²) spreading — see useSession.ts).
  // Here we simulate the caller's responsibility by setting events explicitly.
  let s = emptyState();
  const evs = [
    e({ kind: "message", agentId: "main", role: "assistant", text: "root", seq: 0 } as any),
    e({ kind: "message", agentId: "a2", parentAgentId: "main", role: "assistant", text: "child", seq: 1 } as any),
  ];
  for (const ev of evs) s = reduce(s, ev);
  s = { ...s, events: evs }; // caller sets events (mirrors useSession batch pattern)
  expect(selectAgentEvents(s, "a2").map((x: any) => x.text)).toEqual(["child"]);
});

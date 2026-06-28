import type { SessionState } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";
export function selectAgentEvents(state: SessionState, agentId: string): SessionEvent[] {
  return state.events.filter((e) => e.agentId === agentId);
}

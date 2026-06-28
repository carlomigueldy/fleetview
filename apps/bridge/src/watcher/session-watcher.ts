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

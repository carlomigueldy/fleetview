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

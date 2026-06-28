import { Database } from "bun:sqlite";
import type { SessionEvent, AgentStatus } from "@fleetview/protocol";
import type { SessionMeta } from "../ws-protocol";

// Bump this constant whenever normalize.ts changes the events it emits so that
// a persistent ~/.fleetview.sqlite populated by an older normalizer is
// automatically dropped and rebuilt on next bridge start rather than silently
// serving stale/incomplete event rows (e.g. missing token_usage).
// v4: SessionWatcher now normalizes a session as a unit (all files concatenated
//     and sorted by ts) instead of per-file, fixing the seq collision that caused
//     sidechain events to be silently dropped for multi-file sessions.  Existing
//     SQLite rows for those sessions are incomplete and must be rebuilt.
const NORMALIZER_VERSION = 4;

export class EventLog {
  private db: Database;
  // In-memory agent-count index: sessionId → distinct agentIds seen.
  // Rebuilt incrementally as events are appended; good enough for a single-process bridge.
  private agentCounts = new Map<string, Set<string>>();
  // In-memory status index: sessionId → most recent AgentStatus from session_status
  // or subagent_exit(main) events.  Enables the clay 'waiting' pip when the bridge
  // receives an explicit status signal (e.g. permission-gate detected by normalizer).
  // Falls back to mtime heuristic when absent.
  private lastStatus = new Map<string, AgentStatus>();
  // Track the seq at which each session's 'waiting' latch was set.  Any subsequent
  // progress event (message / tool_call / tool_result / token_usage) with a higher seq
  // means the agent is no longer blocked, so we delete the latch.
  private lastStatusSeq = new Map<string, number>();

  constructor(path = ":memory:") {
    this.db = new Database(path);
    // WAL mode: concurrent readers don't block the writer, eliminates per-commit fsync
    // thrash on the watcher's 750ms tick, keeping bridge CPU/IO low under sustained load.
    this.db.run("PRAGMA journal_mode=WAL");

    // Persistent version table — never dropped, so the version check survives rebuilds.
    this.db.run(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`);

    // If the stored normalizer version differs from the compiled constant, the persisted
    // event rows are stale (produced by an older normalizer that may have emitted
    // different/missing events).  Drop the data tables so the watcher re-ingests every
    // transcript on the next tick and populates them with current normalized events.
    const versionRow = this.db
      .query("SELECT value FROM _meta WHERE key = 'normalizer_version'")
      .get() as { value: string } | null;
    const storedVersion = versionRow ? parseInt(versionRow.value, 10) : 0;
    if (storedVersion !== NORMALIZER_VERSION) {
      this.db.run("DROP TABLE IF EXISTS events");
      this.db.run("DROP TABLE IF EXISTS session_meta");
      this.db
        .prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)")
        .run("normalizer_version", String(NORMALIZER_VERSION));
    }

    this.db.run(
      `CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq))`,
    );
    this.db.run(
      `CREATE TABLE IF NOT EXISTS session_meta (
        session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL, mtime_ms INTEGER NOT NULL, git_branch TEXT)`,
    );
    // Add git_branch to existing databases that were created before this column existed.
    // (Moot when a version bump drops+recreates the table, but retained as a safeguard
    // for same-version deployments.)
    try { this.db.run("ALTER TABLE session_meta ADD COLUMN git_branch TEXT"); } catch { /* already present */ }
  }
  append(events: SessionEvent[]): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO events (session_id, seq, json) VALUES (?, ?, ?)");
    const tx = this.db.transaction((evs: SessionEvent[]) => {
      for (const e of evs) {
        stmt.run(e.sessionId, e.seq, JSON.stringify(e));
        let set = this.agentCounts.get(e.sessionId);
        if (!set) { set = new Set(); this.agentCounts.set(e.sessionId, set); }
        // Mirror the UI's reconciliation in reduce.ts: only count "main" plus real
        // sidechain agent IDs (pure hex, ≥16 chars — as in agent-<id>.jsonl filenames).
        // Spawn-placeholder IDs (e.g. "toolu_01…") and any other short/non-hex IDs are
        // excluded.  Note: this count may exceed the node count rendered by the UI's
        // layout() — layout() only places nodes reachable from 'main' via parentAgentId
        // traversal, so orphan sidechain agents are counted here but not drawn.  The
        // sidebar badge therefore shows "N agents seen", not "N nodes in the colony".
        if (e.agentId === "main" || /^[0-9a-f]{16,}$/i.test(e.agentId)) {
          set.add(e.agentId);
        }
        // Track explicit status signals for session-level pip accuracy.
        // session_status on any agent, or subagent_exit on the main agent, both
        // carry an authoritative AgentStatus that supersedes the mtime heuristic.
        if (
          e.kind === "session_status" ||
          (e.kind === "subagent_exit" && e.agentId === "main")
        ) {
          this.lastStatus.set(e.sessionId, e.status);
          if (e.status === "waiting") {
            // Record when the 'waiting' latch was set so progress events can clear it.
            this.lastStatusSeq.set(e.sessionId, e.seq);
          } else {
            // Non-waiting status supersedes — no need to track the seq.
            this.lastStatusSeq.delete(e.sessionId);
          }
        }
        // Progress events (message / tool_call / tool_result / token_usage) with a
        // seq higher than the seq at which 'waiting' was latched mean the agent has
        // continued working — clear the stale 'waiting' latch so the mtime heuristic
        // (which correctly shows 'working' for recently-modified sessions) takes over.
        if (
          e.kind === "message" ||
          e.kind === "tool_call" ||
          e.kind === "tool_result" ||
          e.kind === "token_usage"
        ) {
          const waitSeq = this.lastStatusSeq.get(e.sessionId);
          if (waitSeq !== undefined && e.seq > waitSeq) {
            this.lastStatus.delete(e.sessionId);
            this.lastStatusSeq.delete(e.sessionId);
          }
        }
      }
    });
    tx(events);
  }
  since(sessionId: string, afterSeq: number): SessionEvent[] {
    const rows = this.db
      .query("SELECT json FROM events WHERE session_id = ? AND seq > ? ORDER BY seq")
      .all(sessionId, afterSeq) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as SessionEvent);
  }
  setMeta(sessionId: string, cwd: string, mtimeMs: number, gitBranch?: string | null): void {
    this.db
      .prepare(
        `INSERT INTO session_meta (session_id, cwd, mtime_ms, git_branch) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET cwd=excluded.cwd, mtime_ms=excluded.mtime_ms, git_branch=excluded.git_branch`,
      )
      .run(sessionId, cwd, mtimeMs, gitBranch ?? null);
  }
  sessions(): SessionMeta[] {
    const now = Date.now();
    const rows = this.db
      .query(
        `SELECT s.session_id, m.cwd, m.mtime_ms, m.git_branch
         FROM (SELECT DISTINCT session_id FROM events) s
         LEFT JOIN session_meta m ON m.session_id = s.session_id
         ORDER BY m.mtime_ms DESC`,
      )
      .all() as { session_id: string; cwd: string | null; mtime_ms: number | null; git_branch: string | null }[];
    return rows.map((r) => {
      const cwd = r.cwd ?? "";
      const gitBranch = r.git_branch ?? null;
      // Prefer git branch as label (e.g. "feat/observe-mvp") — distinct from cwd tail.
      // Falls back to cwd basename, then a UUID prefix when neither is available.
      const label = gitBranch || cwd.split("/").filter(Boolean).pop() || r.session_id.slice(0, 8);
      const mtimeMs = r.mtime_ms ?? 0;
      // Derive status from recency of last transcript modification.
      // 'waiting' (clay — attention color) is ONLY emitted when the agent is
      // verifiably blocked on user input.  Without richer signal we cannot tell
      // "paused mid-task" from "finished 4 minutes ago", so we treat the stale
      // 2-10 min band as idle to avoid spurious clay attention signals.
      //   working  = modified within the last 2 minutes (actively running)
      //   idle     = everything else (stale or completed)
      const age = now - mtimeMs;
      // Prefer an explicit status signal (session_status / subagent_exit on main)
      // when one has been received; the clay 'waiting' pip is only reachable this
      // way.  Fall back to mtime recency when no explicit signal exists.
      //
      // 'waiting' is decoupled from the 2-min recency gate: the latch is already
      // self-clearing (EventLog.append deletes it when any higher-seq progress event
      // arrives), so it cannot go stale while the agent is still making progress.
      // The gate is kept only for an explicit 'working' latch — a stale 'working'
      // (completed session, > 2 min since last transcript touch) must fall back to
      // 'idle' rather than permanently showing sage.
      const explicit = this.lastStatus.get(r.session_id);
      const status: AgentStatus =
        explicit === "waiting"
          ? "waiting"
          : explicit && age < 2 * 60_000
            ? explicit
            : age < 2 * 60_000
              ? "working"
              : "idle";
      const agentCount = this.agentCounts.get(r.session_id)?.size ?? 1;
      return { sessionId: r.session_id, cwd, label, mtimeMs, status, agentCount };
    });
  }
}

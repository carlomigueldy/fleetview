import { stat } from "node:fs/promises";
import type { SessionEvent } from "@fleetview/protocol";
import { walk } from "../transcript/discover";
import { readEntries } from "../transcript/read";
import type { RawEntry } from "../transcript/read";
import { normalize } from "../normalize/normalize";
import type { EventLog } from "../store/event-log";

export class SessionWatcher {
  // sessionId → last appended seq (drives the "only new events" filter).
  // Seq values are globally assigned per-session across all files belonging to that
  // session — normalize() is called once per session (not per file) so the seq stream
  // is monotonic even when a session spans a main .jsonl plus multiple sidechain files.
  private highestSeq = new Map<string, number>();
  // file path → last mtime seen; if unchanged on next scan we skip readEntries
  private lastMtimeMs = new Map<string, number>();
  // file path → {sessionId, cwd} cached from the first successful read of that file
  private fileMeta = new Map<string, { sessionId: string; cwd: string }>();
  // file path → RawEntry[] cached from the last successful read of that file.
  // Retained across scans so unchanged-file entries can be combined with
  // changed-file entries when re-normalizing a session that spans multiple .jsonl
  // files (main + subagents/agent-*.jsonl) all sharing the same sessionId.
  private fileEntries = new Map<string, RawEntry[]>();
  // sessionId → set of file paths known to belong to that session.
  // Built incrementally; used to concatenate ALL files for a session and normalize
  // them as a unit rather than per-file (fixes per-file seq collision).
  private sessionFileIndex = new Map<string, Set<string>>();

  private listeners: ((events: SessionEvent[]) => void)[] = [];
  // Fired after every scan (even when there are no new events), so callers can
  // re-broadcast the sessions list with fresh status pips to all open sockets.
  private scanListeners: (() => void)[] = [];

  constructor(private root: string, private log: EventLog) {}

  onEvents(cb: (events: SessionEvent[]) => void): void {
    this.listeners.push(cb);
  }

  onScan(cb: () => void): void {
    this.scanListeners.push(cb);
  }

  async scanOnce(): Promise<SessionEvent[]> {
    let files: string[];
    try {
      files = await walk(this.root);
    } catch {
      // Root directory missing or inaccessible — fire scan listeners so the
      // server can still push (empty) sessions list to waiting UI clients.
      for (const cb of this.scanListeners) cb();
      return [];
    }

    const fresh: SessionEvent[] = [];
    let fileIndex = 0;

    // Accumulate per-session metadata updates within this scan.
    // A Claude session can span multiple .jsonl files (main + agent sidechains) all
    // sharing the same sessionId.  Processing order inside walk() is arbitrary, so
    // collecting the max mtimeMs per session and flushing once after the loop
    // ensures we always persist the session's true newest-activity timestamp, not
    // whichever file happened to be processed last.
    const metaUpdates = new Map<string, { cwd: string; mtimeMs: number; gitBranch: string | null }>();

    // Sessions that have at least one changed file in this scan must be re-normalized
    // as a unit (all their files' entries concatenated + sorted by ts, then normalize()
    // called once).  This fixes the per-file seq collision: normalize() restarts seq
    // at 0 for each call, but highestSeq is per-session, so whichever file is processed
    // first wins and all subsequent files for the same session are silently dropped.
    const changedSessions = new Set<string>();

    for (const file of files) {
      // Yield every 20 files so the Bun event loop can service pending WebSocket
      // upgrade requests — critical on the initial full scan of 200+ transcripts.
      if (++fileIndex % 20 === 0) await new Promise<void>(r => setTimeout(r, 0));

      let mtimeMs: number;
      try {
        ({ mtimeMs } = await stat(file));
      } catch {
        continue; // file vanished between walk and stat
      }

      const prevMtime = this.lastMtimeMs.get(file);
      const cached = this.fileMeta.get(file);

      // Fast path: mtime unchanged and we already know this file.
      // setMeta was already written to SQLite on the previous scan — no-op here.
      // The file's cached entries remain valid in fileEntries for session re-normalization
      // if a sibling file for the same sessionId changes (handled in the post-loop step).
      if (cached !== undefined && prevMtime === mtimeMs) continue;

      // Slow path: new file OR mtime changed → read and process.
      let entries: RawEntry[];
      try {
        entries = await readEntries(file);
      } catch {
        continue;
      }
      if (entries.length === 0) continue;

      const { sessionId, cwd } = entries[0];
      // Pick the first non-null gitBranch from entries in this file.
      const gitBranch = entries.find((e) => e.gitBranch)?.gitBranch ?? null;

      // Update in-memory mtime + meta caches.
      this.fileMeta.set(file, { sessionId, cwd });
      this.lastMtimeMs.set(file, mtimeMs);
      // Cache the parsed entries so unchanged sibling files can be included when
      // re-normalizing the full session in the post-loop step.
      this.fileEntries.set(file, entries);
      // Register this file under its sessionId for the reverse lookup.
      if (!this.sessionFileIndex.has(sessionId)) this.sessionFileIndex.set(sessionId, new Set());
      this.sessionFileIndex.get(sessionId)!.add(file);
      // Mark the session as needing re-normalization this scan.
      changedSessions.add(sessionId);

      // Accumulate metadata: keep the file with the highest mtime for each session.
      // gitBranch is merged greedily: once we see a non-null value, keep it even if
      // a later (higher-mtime) file doesn't have it (e.g. sidechain files omit branch).
      const prev = metaUpdates.get(sessionId);
      if (!prev || mtimeMs > prev.mtimeMs) {
        metaUpdates.set(sessionId, { cwd, mtimeMs, gitBranch: gitBranch ?? prev?.gitBranch ?? null });
      } else if (gitBranch && !prev.gitBranch) {
        // Lower-mtime file has the branch; preserve it.
        metaUpdates.set(sessionId, { ...prev, gitBranch });
      }
    }

    // ── Per-session normalization ─────────────────────────────────────────────
    // For each session with at least one changed file, concatenate ALL entries from
    // every file known to belong to that session (sorted by ts), then normalize() once
    // to produce a globally-monotonic seq stream across the main file and all sidechain
    // files.  The highestSeq filter then picks up only the events that are new since
    // the last scan, and EventLog.append's INSERT OR REPLACE deduplicates any retries.
    for (const sessionId of changedSessions) {
      const sessionFiles = this.sessionFileIndex.get(sessionId) ?? new Set<string>();
      const allEntries: RawEntry[] = [];
      for (const fp of sessionFiles) {
        const fe = this.fileEntries.get(fp);
        if (fe) allEntries.push(...fe);
      }
      // Sort by timestamp so the combined stream is deterministic regardless of walk order.
      allEntries.sort((a, b) => a.ts - b.ts);

      let all: ReturnType<typeof normalize>;
      try {
        all = normalize(allEntries);
      } catch {
        // Malformed transcript — skip this session so one bad file can't wedge the scan.
        continue;
      }
      const last = this.highestSeq.get(sessionId) ?? -1;
      const newOnes = all.filter((e) => e.seq > last);
      if (newOnes.length === 0) continue;
      this.log.append(newOnes);
      this.highestSeq.set(sessionId, newOnes[newOnes.length - 1].seq);
      fresh.push(...newOnes);
    }

    // Flush per-session metadata once — max-mtime wins across multi-file sessions.
    for (const [sid, m] of metaUpdates) this.log.setMeta(sid, m.cwd, m.mtimeMs, m.gitBranch);

    if (fresh.length) for (const cb of this.listeners) cb(fresh);
    // Always fire scan listeners so the server can push the updated sessions list
    // (status pips change based on mtime recency, not just new events).
    for (const cb of this.scanListeners) cb();
    return fresh;
  }

  start(intervalMs = 750): () => void {
    // Re-entrancy guard: if a previous scanOnce hasn't finished (e.g. it's walking
    // 1500+ files on a slow journaling disk), skip this tick rather than stacking
    // concurrent scans that compound I/O pressure and wedge the bridge.
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void this.scanOnce().finally(() => { inFlight = false; });
    }, intervalMs);
    return () => clearInterval(timer);
  }
}

export type RawEntry = {
  uuid: string;
  parentUuid: string | null;
  type: string;
  sessionId: string;
  cwd: string;
  ts: number;
  isSidechain: boolean;
  agentId: string | null;        // hex ID of the subagent; present when isSidechain:true; matches agent-{agentId}.jsonl filename stem
  attributionAgent: string | null; // e.g. "Explore" or "workflow-subagent"; present on subagent entries
  gitBranch: string | null;      // current git branch at the time the entry was written; e.g. "feat/observe-mvp"
  message: unknown;
};

export async function readEntries(file: string): Promise<RawEntry[]> {
  const text = await Bun.file(file).text();
  const out: RawEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const o = JSON.parse(trimmed) as any;
      if (!o.uuid || !o.sessionId) continue;
      out.push({
        uuid: o.uuid,
        parentUuid: o.parentUuid ?? null,
        type: o.type ?? "unknown",
        sessionId: o.sessionId,
        cwd: o.cwd ?? "",
        ts: o.timestamp ? Date.parse(o.timestamp) : 0,
        isSidechain: Boolean(o.isSidechain),
        agentId: o.agentId ?? null,
        attributionAgent: o.attributionAgent ?? null,
        gitBranch: typeof o.gitBranch === "string" && o.gitBranch ? o.gitBranch : null,
        message: o.message ?? null,
      });
    } catch {
      // skip malformed line
    }
  }
  return out;
}

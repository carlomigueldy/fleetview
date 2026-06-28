import { useState, useEffect, useMemo } from "react";
import type { SessionState, AgentNode } from "../store/reduce";
import { labelFor } from "../store/reduce";
import type { SessionEvent } from "@fleetview/protocol";
import { selectAgentEvents } from "./select-agent-events";

// Client-side sanitization — strips ANSI SGR sequences and unwraps Claude Code
// slash-command XML tags from message text.  The bridge's normalize layer does
// this at event-emission time; this belt-and-suspenders pass handles any events
// that were stored before the bridge fix was deployed.
function sanitizeMessageText(s: string): string {
  // Strip ANSI SGR escape sequences (\x1b[Nm, \x1b[N;Mm, …)
  // eslint-disable-next-line no-control-regex
  let out = s.replace(/\x1b\[[0-9;]*m/g, "");
  // Drop <command-name> and <command-args> wrapper elements
  out = out.replace(/<command-name>[^<]*<\/command-name>/g, "");
  out = out.replace(/<command-args>[^<]*<\/command-args>/g, "");
  // Keep prose inside <command-message>
  out = out.replace(/<command-message>([\s\S]*?)<\/command-message>/g, "$1");
  // Drop implementation-detail blocks wholesale
  out = out.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
  out = out.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  return out.replace(/[ \t]*\n[ \t]*\n[ \t]*\n+/g, "\n\n").trim();
}

type Tab = "transcript" | "tools" | "raw";

// Map raw Claude model IDs to the concise display names used in the approved mockups.
// Pattern: claude-{family}-{major}-{minor} → "{Family} {major}.{minor}"
// Falls back to the raw id when unrecognised.
export function friendlyModelName(raw: string | undefined): string {
  if (!raw) return "–";
  // Normalise: strip vendor prefix and collapse separators.
  // Handles both "claude-opus-4-8" and "claude-opus-4.8" variants.
  const m = raw.match(/claude-([a-z]+)-(\d+)[-.](\d+)/i);
  if (m) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return `${family} ${m[2]}.${m[3]}`;
  }
  // Haiku/Sonnet/Opus without numeric minor (e.g. "claude-3-haiku")
  const m2 = raw.match(/claude-(\d+)-([a-z]+)/i);
  if (m2) {
    const family = m2[2].charAt(0).toUpperCase() + m2[2].slice(1).toLowerCase();
    return `${family} ${m2[1]}`;
  }
  return raw;
}

// Build an ordered crumb array from root → current node by walking parentAgentId links.
function buildCrumb(agents: Map<string, AgentNode>, startId: string): string[] {
  const chain: string[] = [];
  let id: string | null = startId;
  while (id) {
    const n = agents.get(id);
    chain.unshift(n?.label ?? labelFor(id));
    id = n?.parentAgentId ?? null;
  }
  return chain;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function fmtUp(firstTs: number, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - firstTs) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(secs / 3600);
  if (h < 24) {
    const rm = Math.floor((secs % 3600) / 60);
    return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
}

// Pip color per status (matches the approved A×C palette).
const PIP_COLOR: Record<string, string> = {
  working: "var(--color-sage)",
  waiting: "var(--color-clay)",
  idle: "#C3BBA9",
  done: "#C3BBA9",
  error: "var(--color-clay)",
};

// Badge pill style per status.
const BADGE: Record<string, { background: string; color: string; border: string }> = {
  working: { background: "#eef1ea", color: "var(--color-sage)", border: "1px solid #cfd8c5" },
  waiting: { background: "#fdf0eb", color: "var(--color-clay)", border: "1px solid #e8c4b4" },
  idle:    { background: "#f4f1ea", color: "var(--color-muted)", border: "1px solid var(--color-hairline)" },
  done:    { background: "#f4f1ea", color: "var(--color-muted)", border: "1px solid var(--color-hairline)" },
  error:   { background: "#fdf0eb", color: "var(--color-clay)", border: "1px solid #e8c4b4" },
};

// Small child component scopes the per-second interval so the heavy inspector
// body does NOT re-render on every tick — only the uptime text updates.
function UptimeBadge({ firstTs }: { firstTs: number | undefined }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const upStr = firstTs != null ? fmtUp(firstTs, nowMs) : "–";
  return <b style={{ color: "var(--color-ink)", fontWeight: 600 }}>{upStr}</b>;
}

export function NodeInspector({
  state, agentId, onClose,
}: {
  state: SessionState;
  agentId: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("transcript");

  // Escape key dismisses the inspector.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Memoize filtered events — selectAgentEvents re-scans the full array, which can
  // be large; keying on state.events identity avoids re-scanning on every render.
  const events = useMemo(
    () => (agentId ? selectAgentEvents(state, agentId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.events, agentId],
  );

  // Pre-index tool_result events by callId for O(1) pairing in tool cards.
  const results = useMemo(() => {
    const m = new Map<string, { ok: boolean; summary: string }>();
    for (const e of events) {
      if (e.kind === "tool_result") m.set(e.callId, { ok: e.ok, summary: e.summary });
    }
    return m;
  }, [events]);

  const crumb = useMemo(
    () => (agentId ? buildCrumb(state.agents, agentId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.agents, agentId],
  );

  // Raw tab JSON — only stringified when the raw tab is active so streaming event
  // batches on other tabs don't pay the JSON.stringify cost while the view is hidden.
  const rawJson = useMemo(() => (tab === "raw" ? JSON.stringify(events, null, 2) : ""), [events, tab]);

  if (!agentId) return null;

  const node = state.agents.get(agentId);
  const status = node?.status ?? "idle";
  const badgeStyle = BADGE[status] ?? BADGE.idle;
  const firstTs = events[0]?.ts;

  // Tab button style — active tab gets cream background to match mockup.
  const tabStyle = (t: Tab) => ({
    fontSize: 12 as const,
    fontWeight: 600 as const,
    color: tab === t ? "var(--color-ink)" : "var(--color-muted)",
    padding: "8px 12px",
    borderRadius: "9px 9px 0 0",
    cursor: "pointer" as const,
    background: tab === t ? "var(--color-cream)" : "transparent",
    border: "none" as const,
  });

  // Tool card: header row with tool name + target + right-aligned result status,
  // plus an optional <pre> body with the result summary.
  const renderToolCard = (e: Extract<SessionEvent, { kind: "tool_call" }>, key: number | string) => {
    const res = results.get(e.callId);
    return (
      <div
        key={key}
        style={{ border: "1px solid var(--color-hairline)", borderRadius: 11, overflow: "hidden", margin: "8px 0" }}
      >
        <div
          className="font-mono"
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--color-cream)", fontSize: 11.5 }}
        >
          <span style={{ color: "var(--color-clay)" }}>▸</span>
          <b style={{ fontWeight: 500 }}>{e.tool}</b>
          <span style={{ color: "var(--color-muted)" }}>{e.target}</span>
          {res && (
            <span
              style={{
                marginLeft: "auto",
                color: res.ok ? "var(--color-sage)" : "var(--color-clay)",
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {res.ok ? "✓" : "✗"} {res.summary.split("\n")[0].slice(0, 30)}
            </span>
          )}
        </div>
        {res?.summary && (
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
              color: "var(--color-slate)",
              background: "#fcfbf8",
              whiteSpace: "pre-wrap",
              borderTop: "1px solid var(--color-hairline)",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {res.summary}
          </pre>
        )}
      </div>
    );
  };

  return (
    <aside
      className="border-l border-hairline bg-paper h-full flex flex-col min-h-0"
      style={{ boxShadow: "-20px 0 50px -30px rgba(40,25,10,.4)" }}
    >
      {/* ── Inspector header ── */}
      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--color-hairline)", position: "relative" }}>
        {/* Visible close button — top-right of the header panel */}
        <button
          onClick={onClose}
          aria-label="Close inspector"
          style={{
            position: "absolute", top: 14, right: 14,
            width: 26, height: 26, borderRadius: "50%",
            border: "1px solid var(--color-hairline)",
            background: "transparent",
            color: "var(--color-muted)",
            cursor: "pointer",
            fontSize: 14, lineHeight: "24px", textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ×
        </button>

        {/* Breadcrumb: parent chain separated by › */}
        <div className="font-mono" style={{ fontSize: 10.5, color: "var(--color-muted)", paddingRight: 32 }}>
          {crumb.slice(0, -1).map((part, i) => (
            <span key={i}>{part}{" › "}</span>
          ))}
          <b style={{ color: "var(--color-ink)" }}>{crumb[crumb.length - 1]}</b>
        </div>

        {/* Title row: status pip + label + badge pill */}
        <h3
          className="font-display"
          style={{ fontWeight: 600, fontSize: 22, margin: "8px 0 3px", display: "flex", alignItems: "center", gap: 9 }}
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: "50%",
              background: PIP_COLOR[status] ?? "#C3BBA9",
              flexShrink: 0, display: "inline-block",
            }}
          />
          {node?.label ?? labelFor(agentId)}
          <span
            className="font-mono"
            style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 500, ...badgeStyle }}
          >
            {status}
          </span>
        </h3>

        {/* istats row: model / tokens / tools / uptime */}
        <div
          className="font-mono"
          style={{ display: "flex", gap: 18, marginTop: 11, fontSize: 11, color: "var(--color-muted)", flexWrap: "wrap" }}
        >
          <span>model <b style={{ color: "var(--color-ink)", fontWeight: 600 }}>{friendlyModelName(node?.model)}</b></span>
          <span>tokens <b style={{ color: "var(--color-ink)", fontWeight: 600 }}>{fmtTokens(node?.tokens ?? 0)}</b></span>
          <span>tools <b style={{ color: "var(--color-ink)", fontWeight: 600 }}>{node?.tools ?? 0}</b></span>
          <span>up <UptimeBadge firstTs={firstTs} /></span>
        </div>
      </div>

      {/* ── Tab strip ── */}
      <div
        style={{ display: "flex", gap: 4, padding: "10px 16px 0", borderBottom: "1px solid var(--color-hairline)" }}
      >
        {(["transcript", "tools", "raw"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>
            {t === "transcript" ? "Transcript" : t === "tools" ? "Tools" : "Raw events"}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto" style={{ padding: "16px 18px" }}>

        {/* Transcript tab: messages with role labels + inline tool cards */}
        {tab === "transcript" && events.length === 0 && (
          <p className="font-mono" style={{ fontSize: 11, color: "var(--color-muted)", paddingTop: 8 }}>
            {(node?.tokens ?? 0) > 0 || (node?.tools ?? 0) > 0
              ? "Events for this agent are in the earlier part of the session log."
              : "No transcript recorded."}
          </p>
        )}
        {tab === "transcript" && events.map((e, i) => {
          if (e.kind === "message") {
            const displayText = sanitizeMessageText(e.text);
            if (!displayText) return null; // skip pure command-meta messages
            return (
              <div key={i} style={{ marginBottom: 16 }}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--color-muted)",
                    marginBottom: 6,
                  }}
                >
                  {e.role}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--color-ink)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{displayText}</div>
              </div>
            );
          }
          if (e.kind === "tool_call") {
            return renderToolCard(e as Extract<SessionEvent, { kind: "tool_call" }>, i);
          }
          return null;
        })}

        {/* Tools tab: only tool cards, without message text */}
        {tab === "tools" && (() => {
          const toolEvents = events.filter(
            (e): e is Extract<SessionEvent, { kind: "tool_call" }> => e.kind === "tool_call"
          );
          if (toolEvents.length === 0) {
            const totalTools = node?.tools ?? 0;
            return (
              <p className="font-mono" style={{ fontSize: 11, color: "var(--color-muted)", paddingTop: 8 }}>
                {totalTools > 0
                  ? `${totalTools} tool call${totalTools === 1 ? "" : "s"} recorded (outside current event window).`
                  : "No tool calls recorded."}
              </p>
            );
          }
          return toolEvents.map((e, i) => renderToolCard(e, i));
        })()}

        {/* Raw events tab: full JSON dump (memoized — only re-stringifies when events change) */}
        {tab === "raw" && (
          <pre
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10.5,
              color: "var(--color-slate)",
              whiteSpace: "pre-wrap",
              lineHeight: 1.5,
            }}
          >
            {rawJson}
          </pre>
        )}
      </div>
    </aside>
  );
}

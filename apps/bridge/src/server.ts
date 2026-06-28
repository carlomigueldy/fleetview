import { join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import type { SessionEvent } from "@fleetview/protocol";
import type { EventLog } from "./store/event-log";
import type { SessionWatcher } from "./watcher/session-watcher";
import type { ClientMsg, ServerMsg } from "./ws-protocol";

type SocketData = { sessionId?: string };

export function createServer(opts: {
  log: EventLog;
  watcher: SessionWatcher;
  uiDir?: string;
  port: number;
  hostname?: string;
  allowedOrigins?: string[];
}) {
  // Local single-user tool: bind to loopback by default so the bridge (and the
  // session transcripts it serves) is never reachable from the LAN.
  const hostname = opts.hostname ?? "127.0.0.1";
  // CSWSH defense: a browser always sends an Origin on a cross-site WS handshake.
  // Reject any present Origin not on the allow-list; an absent Origin (native
  // clients such as curl/tests) is permitted.
  const allowed = new Set(
    opts.allowedOrigins ?? [
      `http://localhost:${opts.port}`,
      `http://127.0.0.1:${opts.port}`,
      ...(process.env.FLEETVIEW_DEV_ORIGIN ? [process.env.FLEETVIEW_DEV_ORIGIN] : []),
    ],
  );
  const subscribers = new Set<ServerWebSocket<SocketData>>();
  // Re-broadcast the full sessions list after every watcher scan so status pips
  // (working/idle) stay live for all connected UI clients — not just on initial 'list'.
  // Guard: skip when no clients are connected (avoids a full DB query + JSON.stringify
  // on every 750ms tick with an idle UI), and deduplicate byte-identical payloads
  // (status flips on the 2-min mtime boundary so the list rarely changes between ticks).
  let lastSessionsJson: string | null = null;
  opts.watcher.onScan(() => {
    if (!subscribers.size) return;
    const msg: ServerMsg = { type: "sessions", sessions: opts.log.sessions() };
    const json = JSON.stringify(msg);
    if (json === lastSessionsJson) return;
    lastSessionsJson = json;
    for (const ws of subscribers) ws.send(json);
  });
  opts.watcher.onEvents((events) => {
    for (const ws of subscribers) {
      const sid = ws.data.sessionId;
      const slice = sid ? events.filter((e) => e.sessionId === sid) : [];
      if (slice.length) {
        const msg: ServerMsg = { type: "events", events: slice };
        ws.send(JSON.stringify(msg));
      }
    }
  });

  const server = Bun.serve<SocketData>({
    port: opts.port,
    hostname,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const origin = req.headers.get("origin");
        if (origin !== null && !allowed.has(origin)) {
          return new Response("forbidden origin", { status: 403 });
        }
        if (srv.upgrade(req, { data: {} })) return;
        return new Response("upgrade failed", { status: 400 });
      }
      if (opts.uiDir) {
        const rel = url.pathname === "/" ? "/index.html" : url.pathname;
        const base = resolve(opts.uiDir);
        const target = resolve(join(base, decodeURIComponent(rel)));
        if (!target.startsWith(base + sep) && target !== base) {
          return new Response(Bun.file(join(base, "index.html")));
        }
        const file = Bun.file(target);
        return file.exists().then((ok) => (ok ? new Response(file) : new Response(Bun.file(join(base, "index.html")))));
      }
      return new Response("FleetView bridge", { status: 200 });
    },
    websocket: {
      open(ws: ServerWebSocket<SocketData>) { subscribers.add(ws); },
      close(ws: ServerWebSocket<SocketData>) { subscribers.delete(ws); },
      message(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
        // Defensive: never let a malformed or unexpected frame throw in the handler.
        let msg: ClientMsg;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as ClientMsg;
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "list") {
          const reply: ServerMsg = { type: "sessions", sessions: opts.log.sessions() };
          ws.send(JSON.stringify(reply));
        } else if (msg.type === "subscribe") {
          if (typeof msg.sessionId !== "string" || typeof msg.afterSeq !== "number") return;
          ws.data.sessionId = msg.sessionId;
          const backlog: SessionEvent[] = opts.log.since(msg.sessionId, msg.afterSeq);
          const reply: ServerMsg = { type: "events", events: backlog };
          ws.send(JSON.stringify(reply));
        }
      },
    },
  });
  return { stop: () => server.stop(true), port: server.port, hostname };
}

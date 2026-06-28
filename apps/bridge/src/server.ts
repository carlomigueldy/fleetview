import { join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import type { SessionEvent } from "@fleetview/protocol";
import type { EventLog } from "./store/event-log";
import type { SessionWatcher } from "./watcher/session-watcher";
import type { ClientMsg, ServerMsg } from "./ws-protocol";

type SocketData = { sessionId?: string };

export function createServer(opts: { log: EventLog; watcher: SessionWatcher; uiDir?: string; port: number }) {
  const subscribers = new Set<ServerWebSocket<SocketData>>();
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
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
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
      message(ws: ServerWebSocket<SocketData>, raw: string) {
        const msg = JSON.parse(raw) as ClientMsg;
        if (msg.type === "list") {
          const reply: ServerMsg = { type: "sessions", sessions: opts.log.sessions() };
          ws.send(JSON.stringify(reply));
        } else if (msg.type === "subscribe") {
          ws.data.sessionId = msg.sessionId;
          const backlog: SessionEvent[] = opts.log.since(msg.sessionId, msg.afterSeq);
          const reply: ServerMsg = { type: "events", events: backlog };
          ws.send(JSON.stringify(reply));
        }
      },
    },
  });
  return { stop: () => server.stop(true), port: server.port };
}

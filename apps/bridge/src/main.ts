import { homedir } from "node:os";
import { join } from "node:path";
import { EventLog } from "./store/event-log";
import { SessionWatcher } from "./watcher/session-watcher";
import { createServer } from "./server";

const root = join(homedir(), ".claude", "projects");
const log = new EventLog(join(homedir(), ".fleetview.sqlite"));
const watcher = new SessionWatcher(root, log);
watcher.start(750);
const uiDir = process.env.FLEETVIEW_UI_DIR;
const port = Number(process.env.PORT ?? 4317);
const srv = createServer({ log, watcher, uiDir, port, hostname: "127.0.0.1" });
console.log(`FleetView bridge on http://localhost:${srv.port} (loopback only)`);

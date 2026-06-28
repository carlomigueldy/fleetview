#!/usr/bin/env bun
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { EventLog } from "./store/event-log";
import { SessionWatcher } from "./watcher/session-watcher";
import { createServer } from "./server";

const root = join(homedir(), ".claude", "projects");
const uiDir = process.env.FLEETVIEW_UI_DIR ?? resolve(import.meta.dir, "../../ui/dist");
const port = Number(process.env.PORT ?? 4317);
const log = new EventLog(join(homedir(), ".fleetview.sqlite"));
const watcher = new SessionWatcher(root, log);
watcher.start(750);
void watcher.scanOnce();
const srv = createServer({ log, watcher, uiDir, port });
const url = `http://localhost:${srv.port}`;
console.log(`FleetView running at ${url}`);
try { Bun.spawn(["xdg-open", url]); } catch { /* headless ok */ }

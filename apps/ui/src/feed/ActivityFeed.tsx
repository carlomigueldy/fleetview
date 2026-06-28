import type { SessionState } from "../store/reduce";
import { describeEvent } from "./describe-event";

export function ActivityFeed({ state }: { state: SessionState }) {
  const items = state.events.map(describeEvent).filter(Boolean).slice(-30).reverse() as { actor: string; text: string }[];
  return (
    <aside className="border-l border-hairline p-4 overflow-auto">
      <div className="text-[10px] tracking-[0.18em] uppercase text-muted mb-3 font-mono">Activity</div>
      {items.map((it, i) => (
        <div key={i} className="text-[12.5px] py-2 border-b border-hairline text-slate">
          <b className="text-ink font-semibold">{it.actor}</b> {it.text}
        </div>
      ))}
    </aside>
  );
}

import { useEffect, useRef } from "react";
import type { AgentNode } from "../store/reduce";
import { layout, type PositionedNode } from "./layout";

const COL = { working: "#7C8B6F", waiting: "#C96442", idle: "#C3BBA9", done: "#C3BBA9", error: "#C96442" } as const;
const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ColonyTree({ agents, onSelect, selectedId }: { agents: Map<string, AgentNode>; onSelect: (id: string) => void; selectedId: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<PositionedNode[]>([]);

  useEffect(() => {
    const cv = ref.current!; const x = cv.getContext("2d")!;
    let raf = 0; let t = 0;
    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const r = cv.getBoundingClientRect();
      cv.width = r.width * dpr; cv.height = r.height * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const nodes = layout(agents, r.width, r.height); nodesRef.current = nodes;
      const byId = new Map(nodes.map((n) => [n.agentId, n] as const));
      x.clearRect(0, 0, r.width, r.height);
      // edges
      for (const n of nodes) {
        if (!n.parentAgentId) continue;
        const p = byId.get(n.parentAgentId); if (!p) continue;
        const mx = (p.x + n.x) / 2, my = (p.y + n.y) / 2 - 16;
        x.strokeStyle = "rgba(26,23,20,0.30)"; x.lineWidth = 1.5; x.beginPath();
        x.moveTo(p.x, p.y); x.quadraticCurveTo(mx, my, n.x, n.y); x.stroke();
        if (!reduced && n.status === "working") {
          for (let k = 0; k < 3; k++) {
            const pr = ((t * 0.4) + k / 3) % 1;
            const ix = (1 - pr) ** 2 * p.x + 2 * (1 - pr) * pr * mx + pr * pr * n.x;
            const iy = (1 - pr) ** 2 * p.y + 2 * (1 - pr) * pr * my + pr * pr * n.y;
            x.fillStyle = COL[n.status]; x.globalAlpha = 0.8 * (1 - Math.abs(pr - 0.5) * 1.3);
            x.beginPath(); x.arc(ix, iy, 2.2, 0, 7); x.fill(); x.globalAlpha = 1;
          }
        }
      }
      // nodes
      for (const n of nodes) {
        const pulse = reduced ? 0.5 : Math.sin(t * 2 + n.x) * 0.5 + 0.5;
        const c = COL[n.status];
        if (n.agentId === selectedId) { x.beginPath(); x.arc(n.x, n.y, n.r + 12, 0, 7); x.setLineDash([4, 5]); x.strokeStyle = "#C96442"; x.lineWidth = 1.5; x.stroke(); x.setLineDash([]); }
        x.beginPath(); x.arc(n.x, n.y, n.r + 7 + pulse * 6, 0, 7); x.fillStyle = c; x.globalAlpha = 0.1 + pulse * 0.08; x.fill(); x.globalAlpha = 1;
        x.beginPath(); x.arc(n.x, n.y, n.r, 0, 7); x.fillStyle = "#fff"; x.fill();
        x.lineWidth = n.depth === 0 ? 2.4 : 2; x.strokeStyle = n.depth === 0 ? "#1A1714" : c; x.stroke();
        x.fillStyle = "#1A1714"; x.textAlign = "center"; x.font = `${n.depth === 0 ? "600 14px" : "500 11px"} "JetBrains Mono", monospace`;
        x.fillText(n.label, n.x, n.y + n.r + 16);
      }
      t += 0.016; raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [agents, selectedId]);

  const onClick = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    for (const n of nodesRef.current) if ((mx - n.x) ** 2 + (my - n.y) ** 2 <= (n.r + 8) ** 2) { onSelect(n.agentId); return; }
  };
  return <canvas ref={ref} onClick={onClick} className="absolute inset-0 w-full h-full" />;
}

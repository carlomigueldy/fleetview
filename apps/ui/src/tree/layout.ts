import type { AgentNode } from "../store/reduce";

export type PositionedNode = AgentNode & { x: number; y: number; r: number; depth: number };

export function layout(agents: Map<string, AgentNode>, w: number, h: number): PositionedNode[] {
  const cx = w / 2, cy = h / 2;
  const byParent = new Map<string | null, AgentNode[]>();
  for (const a of agents.values()) {
    const k = a.parentAgentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(a);
  }
  const out: PositionedNode[] = [];
  function place(node: AgentNode, x: number, y: number, depth: number, a0: number, a1: number) {
    out.push({ ...node, x, y, depth, r: depth === 0 ? 24 : Math.max(9, 16 - depth * 2) });
    const kids = byParent.get(node.agentId) ?? [];
    const span = a1 - a0;
    kids.forEach((kid, i) => {
      const frac = kids.length === 1 ? 0.5 : i / (kids.length - 1);
      const ang = a0 + span * frac;
      const dist = 150 + depth * 30;
      place(kid, x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, depth + 1, ang - 0.6, ang + 0.6);
    });
  }
  const root = agents.get("main");
  if (root) place(root, cx, cy, 0, -Math.PI, 0);
  return out;
}

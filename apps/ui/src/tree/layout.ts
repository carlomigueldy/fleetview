import type { AgentNode } from "../store/reduce";

export type PositionedNode = AgentNode & { x: number; y: number; r: number; depth: number };

// Maximum direct children to render per node.  When a node has more children
// than this limit (most common: 200+ orphan sidechain agents all re-bucketed
// under 'main'), only the first MAX_VISIBLE_CHILDREN are placed and the rest
// are folded into a single "+N more" aggregate node so the colony stays
// legible and matches the sparse radial tree in the approved mockups.
// Capped at 6 to mirror the ~4-child bloom in the approved fused-main.html mockup.
const MAX_VISIBLE_CHILDREN = 6;

export function layout(agents: Map<string, AgentNode>, w: number, h: number): PositionedNode[] {
  // Offset center to clear the top-left hero block (matches fused-main.html: cx=W*.55, cy=H*.56).
  const cx = w * 0.55, cy = h * 0.56;
  const byParent = new Map<string | null, AgentNode[]>();
  for (const a of agents.values()) {
    const k = a.parentAgentId;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(a);
  }

  // Pre-pass: any node whose parentAgentId is non-null but not present in the
  // agents map is an orphan (its real parent was never seen in events).  Re-bucket
  // it under 'main' so the tree walk reaches it.  This handles the common case
  // of 200+ sidechain agents whose parent hex IDs never appeared as agentId in
  // the transcript — they'd otherwise stay invisible despite being in agents.
  for (const a of agents.values()) {
    if (a.parentAgentId !== null && a.agentId !== "main" && !agents.has(a.parentAgentId)) {
      // Remove from the orphan bucket (keyed by the unresolvable parentAgentId).
      const orphanBucket = byParent.get(a.parentAgentId);
      if (orphanBucket) {
        const idx = orphanBucket.indexOf(a);
        if (idx >= 0) orphanBucket.splice(idx, 1);
        if (orphanBucket.length === 0) byParent.delete(a.parentAgentId);
      }
      // Attach to main's bucket.
      if (!byParent.has("main")) byParent.set("main", []);
      byParent.get("main")!.push(a);
    }
  }

  const out: PositionedNode[] = [];
  // Cycle guard: track visited agentIds so a self- or cyclic parent reference
  // degrades gracefully (skipped) instead of overflowing the call stack.
  const seen = new Set<string>();

  function place(node: AgentNode, x: number, y: number, depth: number, a0: number, a1: number) {
    if (seen.has(node.agentId)) return;
    seen.add(node.agentId);
    out.push({ ...node, x, y, depth, r: depth === 0 ? 24 : depth === 1 ? 14 : 9.5 });

    const allKids = byParent.get(node.agentId) ?? [];
    // Cap fan-out: any children beyond MAX_VISIBLE_CHILDREN are aggregated into
    // a single "+N more" node so the colony stays legible with real-world data.
    const visibleKids = allKids.slice(0, MAX_VISIBLE_CHILDREN);
    const overflowKids = allKids.slice(MAX_VISIBLE_CHILDREN);
    const overflowCount = overflowKids.length;

    // Mark overflow children as seen so the post-pass doesn't scatter them in
    // an extra ring — they are intentionally hidden by the aggregate node.
    for (const k of overflowKids) seen.add(k.agentId);

    // totalSlots = visible kids + (1 overflow node when overflow exists).
    // All slots share the arc evenly so spacing is uniform.
    const totalSlots = visibleKids.length + (overflowCount > 0 ? 1 : 0);
    const span = a1 - a0;

    visibleKids.forEach((kid, i) => {
      const frac = totalSlots <= 1 ? 0.5 : i / (totalSlots - 1);
      const ang = a0 + span * frac;
      // Alternate radial distance for adjacent siblings so co-vertical neighbors
      // don't share the same label baseline — even-index nodes sit at 150, odd
      // at 174, staggering labels vertically enough to avoid overprint.
      const dist = 150 + depth * 30 + (i % 2) * 24;
      place(kid, x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, depth + 1, ang - 0.6, ang + 0.6);
    });

    if (overflowCount > 0) {
      // Place the aggregate node in the last arc slot.
      const ovIdx = visibleKids.length;
      const frac = totalSlots <= 1 ? 0.5 : ovIdx / (totalSlots - 1);
      const ang = a0 + span * frac;
      const dist = 150 + depth * 30 + (ovIdx % 2) * 24;
      const childDepth = depth + 1;
      out.push({
        agentId: `__overflow_${node.agentId}`,
        parentAgentId: node.agentId,
        label: `+${overflowCount}`,
        status: "idle" as const,
        tokens: 0,
        tools: 0,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        depth: childDepth,
        r: childDepth === 1 ? 14 : 9.5,
      });
    }
  }

  const root = agents.get("main");
  // Use a narrower upward-biased arc so children fan across the TOP of 'main'
  // (upper-left to upper-right via the top) and none land horizontally beside it.
  // This matches the sparse "living colony bloom" in the approved fused-main.html
  // mockup and prevents 'main' + neighbour labels from colliding on the horizontal axis.
  if (root) place(root, cx, cy, 0, -Math.PI * 0.80, -Math.PI * 0.20);

  // Post-pass: fold ALL remaining unvisited nodes (e.g. mutual-parent cycles or
  // subtrees whose root was never resolved) into a single '+N sidechains' aggregate
  // node placed below main.  The previous approach scattered up to MAX_VISIBLE_CHILDREN
  // nodes into a dense bottom-semicircle ring and then added a separate '+M' overflow,
  // producing two competing overflow affordances and undermining the sparse colony aesthetic.
  // Now only the main-reachable tree blooms in the upper arc; orphan sidechains surface
  // as one labelled slot so users know they exist without cluttering the stage.
  const unvisited = [...agents.values()].filter((a) => !seen.has(a.agentId));
  if (unvisited.length > 0) {
    // Mark every unvisited node seen so nothing escapes to a future pass.
    for (const u of unvisited) seen.add(u.agentId);
    const rootNode = out.find((p) => p.agentId === "main");
    const rootX = rootNode?.x ?? cx;
    const rootY = rootNode?.y ?? cy;
    // Place aggregate directly below main (ang = π/2) — outside the upper-arc bloom
    // (-0.8π … -0.2π) so it never overlaps real children.
    const ang = Math.PI / 2;
    const dist = 150 + 30;
    out.push({
      agentId: "__overflow_sidechains",
      parentAgentId: "main",
      label: `+${unvisited.length} sidechains`,
      status: "idle" as const,
      tokens: 0,
      tools: 0,
      x: rootX + Math.cos(ang) * dist,
      y: rootY + Math.sin(ang) * dist,
      depth: 1,
      r: 14,
    });
  }

  // Fit-to-bounds: after all nodes are placed, compute the full bounding box
  // (including halo and label clearance) and, when anything falls outside
  // [FIT_PAD, w-FIT_PAD] × [FIT_PAD, h-FIT_PAD], uniformly scale + translate
  // the whole tree to fit.  This handles the common clipping case where the
  // post-pass orphan ring or a deep chain of children exceeds the canvas height.
  // We never upscale (scale is capped at 1.0) so compact trees stay at full size.
  const FIT_PAD = 36;
  if (out.length > 0) {
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const n of out) {
      const hw = n.r + 24;  // horizontal clearance: halo + label width buffer
      const vt = n.r + 10;  // top clearance: halo
      const vb = n.r + 32;  // bottom clearance: halo + label text (~16px) + descender
      if (n.x - hw < bx0) bx0 = n.x - hw;
      if (n.x + hw > bx1) bx1 = n.x + hw;
      if (n.y - vt < by0) by0 = n.y - vt;
      if (n.y + vb > by1) by1 = n.y + vb;
    }
    const treeW = bx1 - bx0;
    const treeH = by1 - by0;
    const availW = w - 2 * FIT_PAD;
    const availH = h - 2 * FIT_PAD;
    // Only compress when the tree exceeds the available stage; never upscale.
    const scale = Math.min(1.0, availW / treeW, availH / treeH);
    if (scale < 1.0) {
      // Translate so the scaled bounding box is centred in the stage.
      const tx = FIT_PAD + (availW - treeW * scale) / 2 - bx0 * scale;
      const ty = FIT_PAD + (availH - treeH * scale) / 2 - by0 * scale;
      for (const n of out) {
        n.x = n.x * scale + tx;
        n.y = n.y * scale + ty;
        n.r = n.r * scale; // scale disc radius proportionally so nodes stay readable
      }
    }
  }

  return out;
}

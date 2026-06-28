import { useEffect, useRef, useCallback, useState } from "react";
import type { AgentNode } from "../store/reduce";
import { layout, type PositionedNode } from "./layout";

const COL = { working: "#7C8B6F", waiting: "#C96442", idle: "#C3BBA9", done: "#C3BBA9", error: "#C96442" } as const;

// Hoisted constants — avoids allocating new strings/arrays on every rAF tick.
// Font strings are module-level so ctx.font assignment is a simple ref copy per node.
const ROOT_FONT  = '600 14px "JetBrains Mono", monospace';
const CHILD_FONT = '500 11.5px "JetBrains Mono", monospace';
const FOCUS_DASH = [3, 4];
const SEL_DASH = [4, 5];
const NO_DASH: number[] = [];

export function ColonyTree({ agents, onSelect, selectedId }: { agents: Map<string, AgentNode>; onSelect: (id: string) => void; selectedId: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Announcement text for the aria-live region — updated on every arrow-key move so
  // screen readers in application mode announce which node is focused.
  const [focusAnnounce, setFocusAnnounce] = useState("");

  // Cached layout — written by Effect B (agents) and ResizeObserver; read by the draw loop.
  const nodesRef = useRef<PositionedNode[]>([]);
  const byIdRef = useRef<Map<string, PositionedNode>>(new Map());

  // Canvas dimensions – written by ResizeObserver only.
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Stable ref mirrors for props — updated synchronously on every render, never trigger effects.
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Track focus by stable agentId (not array index) so a relayout doesn't silently
  // shift focus to a different node.  null = no keyboard focus.
  const focusedIdRef = useRef<string | null>(null);

  // Shared draw callback assigned once in Effect A; consumed by Effect B and the resize path.
  const drawFrameRef = useRef<(() => void) | null>(null);
  const reducedRef = useRef(false);
  const rafRef = useRef(0);
  const tRef = useRef(0);
  // Whether any node is in working/waiting status — only then does animation run.
  const animatingRef = useRef(false);
  // Stable ref to the rAF loop function so Effect B can restart it when agents change.
  const loopRef = useRef<(() => void) | null>(null);

  // ── Effect A: one-time canvas setup ────────────────────────────────────────
  // Sets up the ResizeObserver (canvas resize → relayout → redraw),
  // the prefers-reduced-motion listener, and the rAF draw loop.
  // Never restarts; reads all mutable state from refs.
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;

    // Recompute radial layout from current agents + cached size.
    const relayout = () => {
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return;
      const nodes = layout(agentsRef.current, w, h);
      nodesRef.current = nodes;
      byIdRef.current = new Map(nodes.map((n) => [n.agentId, n] as const));
      animatingRef.current = nodes.some((n) => n.status === "working" || n.status === "waiting");
    };

    // Apply canvas backing-store dimensions when the observed rect changes.
    // Assigning cv.width/cv.height reallocates the GPU buffer — only do it on actual size change.
    const applySize = () => {
      const dpr = devicePixelRatio || 1;
      const { width: w, height: h } = cv.getBoundingClientRect();
      const p = sizeRef.current;
      if (w === p.w && h === p.h && dpr === p.dpr) return;
      cv.width = w * dpr;
      cv.height = h * dpr;
      sizeRef.current = { w, h, dpr };
      relayout();
      // After relayout, ensure the animation loop is running when it should be.
      // Without this guard, a resize that flips animatingRef to true (e.g. a working
      // colony observed at 0×0 on mount then remeasured) leaves the loop paused because
      // the bootstrap path already returned early at 0×0 and rafRef stayed 0.
      if (!reducedRef.current && animatingRef.current && rafRef.current === 0 && loopRef.current) {
        rafRef.current = requestAnimationFrame(loopRef.current);
      } else if (rafRef.current === 0) {
        drawFrameRef.current?.();
      }
    };

    // Core draw routine — reads only refs; dash patterns and font strings are hoisted
    // as module constants, so the hot path allocates nothing per node per frame.
    const draw = () => {
      const { w, h, dpr } = sizeRef.current;
      if (w === 0 || h === 0) return;
      const reduced = reducedRef.current;
      const nodes = nodesRef.current;
      const byId = byIdRef.current;
      const t = tRef.current;
      const selId = selectedIdRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // edges — organic ink with jittered control points + round lineCap
      ctx.lineCap = "round";
      for (const n of nodes) {
        if (!n.parentAgentId) continue;
        const p = byId.get(n.parentAgentId);
        if (!p) continue;
        // Jitter the horizontal mid-point to give organic ink feel (mockup §74)
        const jitter = ((n.x * 7 + n.y * 3) % 25) - 12;
        const mx = (p.x + n.x) / 2 + jitter, my = (p.y + n.y) / 2 - 16;
        ctx.strokeStyle = "rgba(26,23,20,0.32)"; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(mx, my, n.x, n.y); ctx.stroke();
        // Particles flow for non-idle, non-done children: working=sage, waiting=clay
        if (!reduced && n.status !== "idle" && n.status !== "done") {
          for (let k = 0; k < 3; k++) {
            const pr = ((t * 0.4) + k / 3) % 1;
            const ix = (1 - pr) ** 2 * p.x + 2 * (1 - pr) * pr * mx + pr * pr * n.x;
            const iy = (1 - pr) ** 2 * p.y + 2 * (1 - pr) * pr * my + pr * pr * n.y;
            ctx.fillStyle = COL[n.status]; ctx.globalAlpha = 0.85 * (1 - Math.abs(pr - 0.5) * 1.3);
            ctx.beginPath(); ctx.arc(ix, iy, 2.3, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
          }
        }
      }
      ctx.lineCap = "butt"; // reset

      // keyboard focus ring — drawn before nodes so it sits behind them.
      // Resolve the focused agentId to a node via byIdRef (stable across relayouts).
      const focusedId = focusedIdRef.current;
      const fn = focusedId ? byId.get(focusedId) : undefined;
      // Only draw the focus ring when it doesn't coincide with the selection ring —
      // both rings on the same node produce visual noise and dilute the clay color.
      if (fn && focusedId !== selId) {
        ctx.beginPath(); ctx.arc(fn.x, fn.y, fn.r + 16, 0, 7);
        ctx.setLineDash(FOCUS_DASH); ctx.strokeStyle = "#3D4A52"; ctx.lineWidth = 2;
        ctx.stroke(); ctx.setLineDash(NO_DASH);
      }

      // nodes
      for (const n of nodes) {
        const isIdle = n.status === "idle";
        // Idle nodes: pulse=0 gives the minimal halo (r+7, alpha .10) matching the
        // approved mockup (fused-main.html: `const pulse=n.st==='idle'?0:...`).
        // Reduced-motion: static mid value (0.5) for all non-idle nodes.
        const pulse = reduced ? 0.5 : isIdle ? 0 : Math.sin(t * 2 + n.x) * 0.5 + 0.5;
        const c = COL[n.status];
        if (n.agentId === selId) {
          // Ring breathes with the node's own pulse (mockup: r+13+pulse*3 at 80% opacity).
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 13 + pulse * 3, 0, 7);
          ctx.setLineDash(SEL_DASH); ctx.strokeStyle = "#C96442"; ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash(NO_DASH);
        }
        // Breathing halo
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 7 + pulse * 6, 0, 7);
        ctx.fillStyle = c; ctx.globalAlpha = 0.1 + pulse * 0.08; ctx.fill(); ctx.globalAlpha = 1;
        // White paper disc
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
        // Ring — dimmed for idle nodes
        ctx.lineWidth = n.depth === 0 ? 2.4 : 2;
        ctx.strokeStyle = n.depth === 0 ? "#1A1714" : c;
        ctx.globalAlpha = isIdle ? 0.5 : 1; ctx.stroke(); ctx.globalAlpha = 1;
        // Inner core pulsing disc for working nodes
        if (!reduced && n.status === "working") {
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 0.42 * pulse + 2, 0, 7);
          ctx.fillStyle = c; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
        }
        // Label — use hoisted font constants to avoid template-string allocation per node
        ctx.fillStyle = "#1A1714"; ctx.textAlign = "center";
        ctx.font = n.depth === 0 ? ROOT_FONT : CHILD_FONT;
        ctx.fillText(n.label, n.x, n.y + n.r + 16);
      }
    };

    // Expose draw to other effects so they can repaint in reduced-motion mode.
    drawFrameRef.current = draw;

    const loop = () => {
      tRef.current += 0.016;
      draw();
      if (animatingRef.current) {
        // Continue the loop only while something is visually changing.
        rafRef.current = requestAnimationFrame(loop);
      } else {
        // All nodes are idle — draw one final static frame and pause.
        // Effect B will restart the loop when the agents map changes.
        rafRef.current = 0;
      }
    };
    loopRef.current = loop;

    // Prefers-reduced-motion: react to OS setting changes at runtime.
    // Guard for non-DOM/SSR/jsdom environments that lack matchMedia.
    const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    reducedRef.current = mq?.matches ?? false;

    let onMotionChange: ((e: MediaQueryListEvent) => void) | null = null;
    if (mq) {
      onMotionChange = (e: MediaQueryListEvent) => {
        reducedRef.current = e.matches;
        if (e.matches) {
          // Stop the loop and paint one static frame.
          cancelAnimationFrame(rafRef.current);
          draw();
        } else {
          // Resume the animation loop.
          rafRef.current = requestAnimationFrame(loop);
        }
      };
      mq.addEventListener("change", onMotionChange);
    }

    // ResizeObserver: update canvas buffer size only when rect actually changes.
    // Guard for non-DOM/jsdom environments.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(applySize);
      ro.observe(cv);
    }

    // Bootstrap: size the canvas, layout, then start drawing.
    // applySize() calls relayout() which sets animatingRef.current.
    // IMPORTANT: applySize() may itself start the rAF loop (via the guard on line 81)
    // when the canvas already has non-zero dimensions on mount (common in real browsers).
    // We must check rafRef.current === 0 before starting another loop here, otherwise
    // we get two concurrent rAF chains: tRef advances ~2x (double speed), draw cost
    // doubles per frame, and cancelAnimationFrame() on cleanup only cancels one chain —
    // the orphaned chain keeps firing on the detached canvas forever.
    applySize();
    if (rafRef.current === 0) {
      if (reducedRef.current || !animatingRef.current) {
        draw(); // single static frame — no loop (reduced-motion or nothing to animate)
      } else {
        rafRef.current = requestAnimationFrame(loop);
      }
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0; // Reset so the next Effect A run's bootstrap guard starts a fresh loop
      ro?.disconnect();
      if (mq && onMotionChange) mq.removeEventListener("change", onMotionChange);
    };
  }, []); // runs once; all mutable state is accessed through refs

  // ── Effect B: re-layout when the agents map changes ────────────────────────
  // Does NOT touch the canvas buffer (no cv.width/cv.height) — only recomputes
  // the positioned-node arrays so the draw loop picks them up on the next frame.
  useEffect(() => {
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return; // ResizeObserver will trigger relayout once canvas is ready
    const nodes = layout(agents, w, h);
    nodesRef.current = nodes;
    byIdRef.current = new Map(nodes.map((n) => [n.agentId, n] as const));
    const nowAnimating = nodes.some((n) => n.status === "working" || n.status === "waiting");
    animatingRef.current = nowAnimating;
    if (reducedRef.current) {
      // Reduced-motion: the loop is stopped, so we must repaint manually.
      drawFrameRef.current?.();
    } else if (nowAnimating && rafRef.current === 0) {
      // Loop was paused (idle colony) — restart it now that nodes are active.
      if (loopRef.current) rafRef.current = requestAnimationFrame(loopRef.current);
    } else if (!nowAnimating) {
      // Agents changed but nothing animates — draw one static frame.
      drawFrameRef.current?.();
    }
  }, [agents]);

  // ── Effect C: repaint static frame when selection changes ──────────────────
  // Covers two cases where the rAF loop is not running:
  //   1. Reduced-motion: loop is always stopped.
  //   2. Normal-motion idle colony: loop pauses (rafRef.current === 0) once all
  //      nodes settle to idle/done/error.  Without this repaint, clicking a node
  //      in a finished session opens the inspector but the clay selection ring is
  //      never drawn because no pending rAF frame repaints the canvas.
  useEffect(() => {
    if (rafRef.current === 0) drawFrameRef.current?.();
  }, [selectedId]);

  const onClick = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const nodes = nodesRef.current;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if ((mx - n.x) ** 2 + (my - n.y) ** 2 <= (n.r + 8) ** 2) {
        // Overflow aggregate nodes are display-only — skip them so clicking "+N"
        // doesn't open the inspector with an internal __overflow id as the title.
        if (n.agentId.startsWith("__overflow")) continue;
        // Store the stable agentId (not the positional index) so focus survives relayouts.
        focusedIdRef.current = n.agentId;
        onSelect(n.agentId);
        return;
      }
    }
  };

  // Keyboard navigation: arrow keys cycle through nodes; Enter/Space select.
  // Overflow aggregate nodes (__overflow*) are excluded from cycling so focus
  // never lands on a display-only node that has no real inspector entry.
  // Focus is tracked by agentId and resolved to an index at the point of use.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Only navigable (non-overflow) nodes participate in keyboard cycling.
    const navigable = nodesRef.current.filter((n) => !n.agentId.startsWith("__overflow"));
    if (navigable.length === 0) return;
    // Resolve current focusedId → index within navigable list (-1 if none/not found)
    const curId = focusedIdRef.current;
    const curIdx = curId !== null ? navigable.findIndex((n) => n.agentId === curId) : -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = (curIdx + 1) % navigable.length;
      focusedIdRef.current = navigable[nextIdx].agentId;
      // Announce to AT: update the live region so screen readers narrate the new focus.
      setFocusAnnounce(navigable[nextIdx].label);
      // Repaint when the loop is not running (reduced-motion OR idle-paused colony).
      if (rafRef.current === 0) drawFrameRef.current?.();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const len = navigable.length;
      const prevIdx = (curIdx - 1 + len) % len;
      focusedIdRef.current = navigable[prevIdx].agentId;
      setFocusAnnounce(navigable[prevIdx].label);
      if (rafRef.current === 0) drawFrameRef.current?.();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const id = focusedIdRef.current;
      // Guard: overflow nodes are excluded from cycling but might still be stored in
      // focusedIdRef if a prior session set it; skip them on activation too.
      if (id !== null && !id.startsWith("__overflow") && byIdRef.current.has(id)) onSelect(id);
    }
  }, [onSelect]);

  // When the canvas receives Tab focus, default focusedIdRef to the first navigable
  // (non-overflow) node so a visible focus ring is painted immediately.
  const onFocus = useCallback(() => {
    if (focusedIdRef.current !== null) return; // already focused — leave it
    const first = nodesRef.current.find((n) => !n.agentId.startsWith("__overflow"));
    if (!first) return;
    focusedIdRef.current = first.agentId;
    setFocusAnnounce(first.label);
    // Repaint immediately when the rAF loop is paused (idle colony or reduced-motion).
    if (rafRef.current === 0) drawFrameRef.current?.();
  }, []);

  // Clear focus tracking when the canvas loses focus so the ring is not drawn after
  // Tab-out.  Repaint to erase the ring from the static frame.
  const onBlur = useCallback(() => {
    focusedIdRef.current = null;
    setFocusAnnounce("");
    if (rafRef.current === 0) drawFrameRef.current?.();
  }, []);

  return (
    <>
      <canvas
        ref={ref}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        tabIndex={0}
        role="application"
        aria-label="Agent colony tree — use arrow keys to navigate, Enter to inspect"
        className="absolute inset-0 w-full h-full"
      />
      {/* Visually-hidden aria-live region announces the focused node label to
          screen readers in application mode as the user navigates with arrow keys. */}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute", width: 1, height: 1, overflow: "hidden",
          clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
        }}
      >
        {focusAnnounce}
      </span>
    </>
  );
}

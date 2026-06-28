import { layout } from "./layout";
import type { AgentNode } from "../store/reduce";

const node = (id: string, parent: string | null): AgentNode => ({ agentId: id, parentAgentId: parent, label: id, status: "working", tokens: 0, tools: 0 });

test("places root at center and children around it", () => {
  const agents = new Map<string, AgentNode>([
    ["main", node("main", null)], ["a", node("a", "main")], ["b", node("b", "main")],
  ]);
  const positioned = layout(agents, 1000, 800);
  const root = positioned.find((p) => p.agentId === "main")!;
  // cx = w * 0.55 = 1000 * 0.55 = 550 (offset to clear top-left hero block)
  expect(Math.round(root.x)).toBe(550);
  expect(root.depth).toBe(0);
  const a = positioned.find((p) => p.agentId === "a")!;
  expect(a.depth).toBe(1);
  expect(a.x === root.x && a.y === root.y).toBe(false);
});

test("cycle guard: self-referencing parent does not overflow the stack", () => {
  // A node that is its own parent would recurse forever without the visited guard.
  const agents = new Map<string, AgentNode>([
    ["main", node("main", null)],
    ["a", node("a", "a")], // self-parent cycle
  ]);
  expect(() => layout(agents, 1000, 800)).not.toThrow();
});

test("cycle guard: mutual parent cycle does not overflow the stack", () => {
  const agents = new Map<string, AgentNode>([
    ["main", node("main", null)],
    ["a", node("a", "b")], // a → b → a → …
    ["b", node("b", "a")],
  ]);
  expect(() => layout(agents, 1000, 800)).not.toThrow();
  // Root "main" should still be placed even though children form a cycle.
  const positioned = layout(agents, 1000, 800);
  expect(positioned.some((p) => p.agentId === "main")).toBe(true);
});

test("depth-scaled sizing: deeper nodes get smaller radii", () => {
  // Verifies the depth-based radius formula is active (depth 0 = 24, depth 1 = 14, depth 2 = 9.5).
  const agents = new Map<string, AgentNode>([
    ["main", node("main", null)],
    ["a", node("a", "main")],
    ["b", node("b", "a")], // depth 2
  ]);
  const positioned = layout(agents, 1000, 800);
  const root = positioned.find((p) => p.agentId === "main")!;
  const child = positioned.find((p) => p.agentId === "a")!;
  const grandchild = positioned.find((p) => p.agentId === "b")!;
  expect(root.r).toBe(24); // depth 0
  expect(child.r).toBeLessThan(root.r); // depth 1
  expect(grandchild.r).toBeLessThanOrEqual(child.r); // depth 2
  expect(grandchild.depth).toBe(2);
});

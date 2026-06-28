import { layout } from "./layout";
import type { AgentNode } from "../store/reduce";

const node = (id: string, parent: string | null): AgentNode => ({ agentId: id, parentAgentId: parent, label: id, status: "working", tokens: 0, tools: 0 });

test("places root at center and children around it", () => {
  const agents = new Map<string, AgentNode>([
    ["main", node("main", null)], ["a", node("a", "main")], ["b", node("b", "main")],
  ]);
  const positioned = layout(agents, 1000, 800);
  const root = positioned.find((p) => p.agentId === "main")!;
  expect(Math.round(root.x)).toBe(500);
  expect(root.depth).toBe(0);
  const a = positioned.find((p) => p.agentId === "a")!;
  expect(a.depth).toBe(1);
  expect(a.x === root.x && a.y === root.y).toBe(false);
});

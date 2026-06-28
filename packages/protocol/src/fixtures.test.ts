/**
 * Task 0: Spike — transcript format characterization tests.
 *
 * These tests parse the captured fixture files and assert that the fields
 * and structural patterns documented in the spike findings are actually
 * present and correct. They are deterministic (no network, no filesystem
 * outside the fixtures directory, no randomness).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dir, "..", "fixtures");

function parseJsonl(relPath: string): Record<string, unknown>[] {
  const abs = join(FIXTURES, relPath);
  return readFileSync(abs, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// simple-session.jsonl
// ---------------------------------------------------------------------------

describe("simple-session.jsonl", () => {
  const lines = parseJsonl("simple-session.jsonl");

  it("has exactly 6 lines", () => {
    expect(lines.length).toBe(6);
  });

  it("every conversation entry has sessionId, timestamp, and type", () => {
    for (const entry of lines) {
      if (entry.type === "queue-operation") continue; // queue entries differ
      expect(typeof entry.sessionId).toBe("string");
      expect(typeof entry.timestamp).toBe("string");
      expect(typeof entry.type).toBe("string");
    }
  });

  it("all entries share the same sessionId", () => {
    const ids = new Set(
      lines
        .filter((e) => typeof e.sessionId === "string")
        .map((e) => e.sessionId)
    );
    expect(ids.size).toBe(1);
  });

  it("contains at least one user entry and one assistant entry", () => {
    const types = lines.map((e) => e.type);
    expect(types).toContain("user");
    expect(types).toContain("assistant");
  });

  it("no entry has isSidechain: true (flat single-agent session)", () => {
    for (const entry of lines) {
      if ("isSidechain" in entry) {
        expect(entry.isSidechain).toBe(false);
      }
    }
  });

  it("assistant entries have message.role === 'assistant'", () => {
    const assistants = lines.filter((e) => e.type === "assistant");
    expect(assistants.length).toBeGreaterThan(0);
    for (const a of assistants) {
      const msg = a.message as Record<string, unknown>;
      expect(msg.role).toBe("assistant");
    }
  });

  it("split assistant entries share the same message.id", () => {
    // A single API response may be split across two consecutive assistant entries.
    const assistants = lines.filter((e) => e.type === "assistant");
    expect(assistants.length).toBeGreaterThanOrEqual(2);
    const ids = assistants.map((a) => (a.message as Record<string, unknown>).id);
    // At least one id must be shared by >= 2 entries (splitting occurred).
    expect(ids.length - new Set(ids).size).toBeGreaterThanOrEqual(1);
  });

  it("user tool_result entry has sourceToolAssistantUUID", () => {
    const toolResults = lines.filter((e) => {
      const msg = e.message as Record<string, unknown> | undefined;
      if (!msg) return false;
      const content = msg.content;
      if (!Array.isArray(content)) return false;
      return content.some(
        (block: unknown) =>
          (block as Record<string, unknown>).type === "tool_result"
      );
    });
    expect(toolResults.length).toBeGreaterThan(0);
    for (const entry of toolResults) {
      expect(typeof entry.sourceToolAssistantUUID).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// subagent-session.jsonl (main agent transcript)
// ---------------------------------------------------------------------------

describe("subagent-session.jsonl (main agent)", () => {
  const lines = parseJsonl("subagent-session.jsonl");

  it("has exactly 3 lines", () => {
    expect(lines.length).toBe(3);
  });

  it("no entry has isSidechain: true (sidechain entries live in subagent file)", () => {
    for (const entry of lines) {
      if ("isSidechain" in entry) {
        expect(entry.isSidechain).toBe(false);
      }
    }
  });

  it("contains an assistant entry with an Agent tool_use block", () => {
    const assistants = lines.filter((e) => e.type === "assistant");
    const agentToolUseEntry = assistants.find((a) => {
      const msg = a.message as Record<string, unknown>;
      const content = msg.content;
      if (!Array.isArray(content)) return false;
      return content.some(
        (block: unknown) =>
          (block as Record<string, unknown>).name === "Agent" &&
          (block as Record<string, unknown>).type === "tool_use"
      );
    });
    expect(agentToolUseEntry).toBeDefined();
  });

  it("Agent tool_use input has description, model, prompt, subagent_type keys (no 'name' key)", () => {
    for (const entry of lines) {
      if (entry.type !== "assistant") continue;
      const msg = entry.message as Record<string, unknown>;
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && b.name === "Agent") {
          const input = b.input as Record<string, unknown>;
          expect(input).toHaveProperty("description");
          expect(input).toHaveProperty("model");
          expect(input).toHaveProperty("prompt");
          expect(input).toHaveProperty("subagent_type");
          expect(input).not.toHaveProperty("name");
        }
      }
    }
  });

  it("tool_result for Agent spawn contains agentId in toolUseResult", () => {
    const userEntries = lines.filter((e) => e.type === "user");
    const spawnAck = userEntries.find((e) => {
      const r = e.toolUseResult as Record<string, unknown> | undefined;
      return r && typeof r.agentId === "string";
    });
    expect(spawnAck).toBeDefined();
    const ack = (spawnAck as Record<string, unknown>).toolUseResult as Record<string, unknown>;
    expect(typeof ack.agentId).toBe("string");
    expect(typeof ack.agentType).toBe("string");
    expect(typeof ack.resolvedModel).toBe("string");
    expect(typeof ack.totalDurationMs).toBe("number");
    expect(typeof ack.totalTokens).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// subagent sidechain file
// ---------------------------------------------------------------------------

describe("subagent-session/subagents/agent-ae646fa4217c97fe7.jsonl (sidechain)", () => {
  const lines = parseJsonl(
    "subagent-session/subagents/agent-ae646fa4217c97fe7.jsonl"
  );

  it("has exactly 5 lines", () => {
    expect(lines.length).toBe(5);
  });

  it("every entry has isSidechain: true", () => {
    for (const entry of lines) {
      expect(entry.isSidechain).toBe(true);
    }
  });

  it("every entry has agentId === 'ae646fa4217c97fe7'", () => {
    for (const entry of lines) {
      expect(entry.agentId).toBe("ae646fa4217c97fe7");
    }
  });

  it("first entry has parentUuid: null", () => {
    expect(lines[0].parentUuid).toBeNull();
  });

  it("all entries share the same sessionId as the main agent", () => {
    const ids = new Set(
      lines.filter((e) => typeof e.sessionId === "string").map((e) => e.sessionId)
    );
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe("a19455d2-60c1-4032-a011-6ed34b11176a");
  });

  it("assistant entries carry attributionAgent field", () => {
    const assistants = lines.filter((e) => e.type === "assistant");
    expect(assistants.length).toBeGreaterThan(0);
    for (const a of assistants) {
      expect(typeof a.attributionAgent).toBe("string");
    }
  });

  it("contains an attachment entry with deferred_tools_delta", () => {
    const attachments = lines.filter((e) => e.type === "attachment");
    expect(attachments.length).toBeGreaterThan(0);
    for (const a of attachments) {
      const att = a.attachment as Record<string, unknown>;
      expect(att.type).toBe("deferred_tools_delta");
    }
  });
});

// ---------------------------------------------------------------------------
// workflow-session.jsonl
// ---------------------------------------------------------------------------

describe("workflow-session.jsonl", () => {
  const lines = parseJsonl("workflow-session.jsonl");

  it("has exactly 3 lines", () => {
    expect(lines.length).toBe(3);
  });

  it("contains an assistant entry with a Workflow tool_use block", () => {
    const assistants = lines.filter((e) => e.type === "assistant");
    const workflowEntry = assistants.find((a) => {
      const msg = a.message as Record<string, unknown>;
      const content = msg.content;
      if (!Array.isArray(content)) return false;
      return content.some(
        (block: unknown) =>
          (block as Record<string, unknown>).name === "Workflow" &&
          (block as Record<string, unknown>).type === "tool_use"
      );
    });
    expect(workflowEntry).toBeDefined();
  });

  it("Workflow tool_use input has scriptPath key (not script+args)", () => {
    for (const entry of lines) {
      if (entry.type !== "assistant") continue;
      const msg = entry.message as Record<string, unknown>;
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && b.name === "Workflow") {
          const input = b.input as Record<string, unknown>;
          expect(input).toHaveProperty("scriptPath");
          expect(input).not.toHaveProperty("script");
          expect(input).not.toHaveProperty("args");
        }
      }
    }
  });

  it("Workflow ack toolUseResult has status: async_launched with expected fields", () => {
    const userEntries = lines.filter((e) => e.type === "user");
    const ackEntry = userEntries.find((e) => {
      const r = e.toolUseResult as Record<string, unknown> | undefined;
      return r && r.status === "async_launched";
    });
    expect(ackEntry).toBeDefined();
    const ack = (ackEntry as Record<string, unknown>).toolUseResult as Record<string, unknown>;
    expect(ack.status).toBe("async_launched");
    expect(typeof ack.taskId).toBe("string");
    expect(typeof ack.runId).toBe("string");
    expect(typeof ack.workflowName).toBe("string");
    expect(typeof ack.transcriptDir).toBe("string");
  });

  it("split assistant entries share the same message.id (Workflow tool_use split)", () => {
    const assistants = lines.filter((e) => e.type === "assistant");
    expect(assistants.length).toBeGreaterThanOrEqual(2);
    const msgIds = assistants.map((a) => (a.message as Record<string, unknown>).id as string);
    // All should be strings
    for (const id of msgIds) {
      expect(typeof id).toBe("string");
    }
    // The two assistant entries share the same message.id (splitting occurred)
    const uniqueIds = new Set(msgIds);
    expect(uniqueIds.size).toBeLessThan(assistants.length);
  });
});

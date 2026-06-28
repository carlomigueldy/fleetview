import { renderHook, act } from "@testing-library/react";
import { useSessions } from "./useSessions";

/**
 * Minimal WebSocket mock that captures the last created instance so tests can
 * drive it by calling `triggerMessage` / `triggerOpen`.
 */
let lastWs: MockWs | null = null;

class MockWs {
  static OPEN = 1;
  readyState = MockWs.OPEN;
  sentMessages: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {
    lastWs = this;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.onclose?.();
  }

  /** Helper: simulate the server opening the connection. */
  triggerOpen() {
    this.onopen?.();
  }

  /** Helper: simulate a message arriving from the bridge. */
  triggerMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  /** Helper: simulate a WS error. */
  triggerError() {
    this.onerror?.();
  }
}

// Install the mock before tests and restore after.
const originalWebSocket = globalThis.WebSocket;
beforeAll(() => {
  // @ts-expect-error replacing global for test purposes
  globalThis.WebSocket = MockWs;
});
afterAll(() => {
  globalThis.WebSocket = originalWebSocket;
});
beforeEach(() => {
  lastWs = null;
});

test("initial status is connecting", () => {
  const { result } = renderHook(() => useSessions());
  expect(result.current.status).toBe("connecting");
  expect(result.current.sessions).toHaveLength(0);
});

test("sends a list request on open", () => {
  renderHook(() => useSessions());
  act(() => { lastWs!.triggerOpen(); });
  expect(lastWs!.sentMessages).toContainEqual(JSON.stringify({ type: "list" }));
});

test("maps SessionMeta[] wire shape to SessionSummary[] correctly and sorts most-recent-first", () => {
  const { result } = renderHook(() => useSessions());

  act(() => {
    lastWs!.triggerOpen();
    lastWs!.triggerMessage({
      type: "sessions",
      sessions: [
        { sessionId: "abc-123", cwd: "/home/carlo/study-companion", label: "study-companion", mtimeMs: 1000 },
        { sessionId: "def-456", cwd: "/home/carlo/rag-local", label: "rag-local", mtimeMs: 2000 },
      ],
    });
  });

  const { sessions, status } = result.current;
  expect(status).toBe("ready");
  expect(sessions).toHaveLength(2);

  // Sorted most-recent-first: def-456 (mtimeMs:2000) before abc-123 (mtimeMs:1000)
  expect(sessions[0].sessionId).toBe("def-456");
  expect(sessions[0].label).toBe("rag-local");
  expect(sessions[0].cwd).toBe("/home/carlo/rag-local");
  expect(sessions[0].mtimeMs).toBe(2000);
  expect(sessions[0].status).toBe("idle");

  expect(sessions[1].sessionId).toBe("abc-123");
  expect(sessions[1].label).toBe("study-companion");
  expect(sessions[1].cwd).toBe("/home/carlo/study-companion");
  expect(sessions[1].mtimeMs).toBe(1000);
  expect(sessions[1].status).toBe("idle");
});

test("uses sessionId prefix as label when label is empty", () => {
  const { result } = renderHook(() => useSessions());

  act(() => {
    lastWs!.triggerOpen();
    lastWs!.triggerMessage({
      type: "sessions",
      sessions: [
        { sessionId: "abcdef12-0000-0000-0000-000000000000", cwd: "", label: "", mtimeMs: 0 },
      ],
    });
  });

  expect(result.current.sessions[0].label).toBe("abcdef12");
});

test("does NOT throw when sessionId items arrive as objects (regression guard)", () => {
  const { result } = renderHook(() => useSessions());

  // This is the exact runtime behavior that the old code threw on:
  // msg.sessions.map((id: string) => id.slice(0, 8)) where id is actually an object.
  expect(() => {
    act(() => {
      lastWs!.triggerOpen();
      lastWs!.triggerMessage({
        type: "sessions",
        sessions: [
          { sessionId: "xyz-789", cwd: "/home/carlo/project", label: "project", mtimeMs: 0 },
        ],
      });
    });
  }).not.toThrow();

  // Sessions must be populated — the old code threw and setSessions was never called.
  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.sessions[0].sessionId).toBe("xyz-789");
});

test("ignores malformed (non-JSON) frames without throwing", () => {
  const { result } = renderHook(() => useSessions());

  expect(() => {
    act(() => {
      lastWs!.triggerOpen();
      // Trigger a malformed frame directly (bypassing triggerMessage JSON.stringify)
      lastWs!.onmessage?.({ data: "not json {{{" });
    });
  }).not.toThrow();

  expect(result.current.sessions).toHaveLength(0);
});

test("ignores unknown message types", () => {
  const { result } = renderHook(() => useSessions());

  act(() => {
    lastWs!.triggerOpen();
    lastWs!.triggerMessage({ type: "events", events: [] });
  });

  expect(result.current.sessions).toHaveLength(0);
});

test("status transitions to error on WS error when not yet ready", () => {
  const { result } = renderHook(() => useSessions());

  act(() => {
    lastWs!.triggerOpen();
    lastWs!.triggerError();
  });

  expect(result.current.status).toBe("error");
});

test("status stays ready on WS error after receiving sessions", () => {
  const { result } = renderHook(() => useSessions());

  act(() => {
    lastWs!.triggerOpen();
    lastWs!.triggerMessage({
      type: "sessions",
      sessions: [{ sessionId: "s1", cwd: "/x", label: "x", mtimeMs: 0 }],
    });
  });

  act(() => {
    lastWs!.triggerError();
  });

  // Once ready, a subsequent error should not downgrade status
  expect(result.current.status).toBe("ready");
});

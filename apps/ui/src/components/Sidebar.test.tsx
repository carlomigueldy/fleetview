import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar, relativeTime } from "./Sidebar";

test("renders sessions and fires onSelect", () => {
  const onSelect = vi.fn();
  render(
    <Sidebar
      sessions={[{ sessionId: "s1", label: "refactor-auth", cwd: "/home/carlo/refactor-auth", mtimeMs: 1000, status: "working" }]}
      activeId={null}
      onSelect={onSelect}
      status="ready"
    />
  );
  fireEvent.click(screen.getByText("refactor-auth"));
  expect(onSelect).toHaveBeenCalledWith("s1");
});

// ── relativeTime unit tests ───────────────────────────────────────────────────
// Ensures the per-row age token is correct so colliding sessions can be
// distinguished by the human eye (Issue 2 fix).

test("relativeTime returns empty string for zero/missing mtimeMs", () => {
  expect(relativeTime(0)).toBe("");
});

test("relativeTime returns 'just now' for very recent sessions", () => {
  expect(relativeTime(Date.now() - 5_000)).toBe("just now");
});

test("relativeTime returns minutes for sessions < 1h old", () => {
  expect(relativeTime(Date.now() - 90_000)).toBe("1m ago");
  expect(relativeTime(Date.now() - 30 * 60_000)).toBe("30m ago");
});

test("relativeTime returns hours for sessions < 24h old", () => {
  expect(relativeTime(Date.now() - 2 * 60 * 60_000)).toBe("2h ago");
});

test("relativeTime returns days for old sessions", () => {
  expect(relativeTime(Date.now() - 3 * 24 * 60 * 60_000)).toBe("3d ago");
});

test("metaLine includes relative time when mtimeMs is set", () => {
  const onSelect = vi.fn();
  const recentMs = Date.now() - 5_000; // 5 seconds ago → "just now"
  render(
    <Sidebar
      sessions={[{ sessionId: "s2", label: "feat/observe-mvp", cwd: "/home/carlo/fleetview", mtimeMs: recentMs, status: "idle" }]}
      activeId={null}
      onSelect={onSelect}
      status="ready"
    />
  );
  // The meta line should contain the relative age token
  const metaEl = screen.getByText(/just now/);
  expect(metaEl).toBeTruthy();
});

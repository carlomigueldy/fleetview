import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

test("renders sessions and fires onSelect", () => {
  const onSelect = vi.fn();
  render(<Sidebar sessions={[{ sessionId: "s1", label: "refactor-auth", status: "working" }]} activeId={null} onSelect={onSelect} />);
  fireEvent.click(screen.getByText("refactor-auth"));
  expect(onSelect).toHaveBeenCalledWith("s1");
});

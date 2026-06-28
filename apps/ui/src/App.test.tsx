import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { test, expect } from "vitest";

test("renders the FleetView shell", () => {
  render(<App />);
  expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  expect(screen.getByText("FleetView")).toBeInTheDocument();
});

test("shows Activity feed header when no agent is selected", () => {
  render(<App />);
  expect(screen.getByText("Activity")).toBeInTheDocument();
});

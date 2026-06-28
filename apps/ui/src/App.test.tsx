import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the FleetView shell", () => {
  render(<App />);
  expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  expect(screen.getByText("FleetView")).toBeInTheDocument();
});

import { expect, test } from "vitest";
import { PROTOCOL_VERSION } from "./index";

test("protocol package builds and exports a version", () => {
  expect(PROTOCOL_VERSION).toBe(1);
});

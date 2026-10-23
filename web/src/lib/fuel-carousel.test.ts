import { describe, expect, it } from "vitest";

import { resolveActiveFuel, stepFuelIndex } from "./fuel-carousel";

describe("resolveActiveFuel", () => {
  it("keeps the current fuel while it is still present", () => {
    expect(resolveActiveFuel(["Diesel", "95"], "95")).toBe("95");
  });

  it("falls back to the first fuel when the current one disappears", () => {
    expect(resolveActiveFuel(["Diesel", "95"], "98")).toBe("Diesel");
    expect(resolveActiveFuel(["Diesel"], null)).toBe("Diesel");
  });

  it("has nothing to select without fuels", () => {
    expect(resolveActiveFuel([], "Diesel")).toBeNull();
  });
});

describe("stepFuelIndex", () => {
  it("moves within the available fuels", () => {
    expect(stepFuelIndex(3, 0, 1)).toBe(1);
    expect(stepFuelIndex(3, 2, -1)).toBe(1);
  });

  it("clamps at both ends", () => {
    expect(stepFuelIndex(3, 0, -1)).toBe(0);
    expect(stepFuelIndex(3, 2, 1)).toBe(2);
    expect(stepFuelIndex(0, 0, 1)).toBe(0);
  });
});

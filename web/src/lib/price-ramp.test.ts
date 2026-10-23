import { describe, expect, it } from "vitest";

import { buildPriceRamp, priceColor } from "./price-ramp";

describe("priceColor", () => {
  it("returns green at the cheap end and red at the dear end", () => {
    expect(priceColor(1, 1, 3)).toBe("rgb(70, 211, 154)");
    expect(priceColor(3, 1, 3)).toBe("rgb(255, 122, 122)");
  });

  it("returns amber in the middle", () => {
    expect(priceColor(2, 1, 3)).toBe("rgb(240, 180, 41)");
  });

  it("falls back to grey for unknown values", () => {
    expect(priceColor(null, 1, 3)).toBe("#8aa1b6");
    expect(priceColor(undefined, 1, 3)).toBe("#8aa1b6");
  });

  it("handles a degenerate range", () => {
    expect(priceColor(2, 2, 2)).toBe("rgb(70, 211, 154)");
  });
});

describe("buildPriceRamp", () => {
  it("computes min and max from the known values", () => {
    const ramp = buildPriceRamp([2.1, null, 1.9, 2.4]);
    expect(ramp.min).toBeCloseTo(1.9, 4);
    expect(ramp.max).toBeCloseTo(2.4, 4);
    expect(ramp.legend).toHaveLength(3);
  });

  it("returns no legend when there is nothing to colour", () => {
    const ramp = buildPriceRamp([null, undefined]);
    expect(ramp.min).toBeNull();
    expect(ramp.legend).toEqual([]);
    expect(ramp.colorFor(2)).toBe("#8aa1b6");
  });

  it("orders the legend from cheapest to dearest", () => {
    const ramp = buildPriceRamp([1.9, 2.4]);
    expect(ramp.legend[0].label).toBe("mais barato");
    expect(ramp.legend[2].label).toBe("mais caro");
    expect(ramp.legend[0].color).not.toBe(ramp.legend[2].color);
  });
});

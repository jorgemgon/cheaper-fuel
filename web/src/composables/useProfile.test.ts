import { describe, expect, it } from "vitest";

import { DEFAULT_RADIUS_KM, useProfile } from "./useProfile";

describe("profile defaults", () => {
  it("opens with a 5 km radius", () => {
    expect(DEFAULT_RADIUS_KM).toBe(5);
    expect(useProfile().profile.value.radiusKm).toBe(DEFAULT_RADIUS_KM);
  });

  it("opens with diesel and petrol 95 selected", () => {
    expect(useProfile().profile.value.fuels).toEqual([
      "Gasóleo simples",
      "Gasolina simples 95",
    ]);
  });
});

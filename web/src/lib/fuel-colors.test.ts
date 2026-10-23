import { describe, expect, it } from "vitest";

import { FUEL_COLOR_FALLBACK, fuelColor } from "./fuel-colors";

describe("fuelColor", () => {
  it("gives diesel its yellow family", () => {
    expect(fuelColor("Gasóleo simples")).toBe("#f2c200");
    // The special is a lighter shade of the same yellow.
    expect(fuelColor("Gasóleo especial")).toBe("#f8dd75");
    // Marked/agricultural diesel is a deeper yellow.
    expect(fuelColor("Gasóleo colorido")).toBe("#d9a400");
  });

  it("gives both petrol grades the same lime green", () => {
    expect(fuelColor("Gasolina simples 95")).toBe("#a3e635");
    expect(fuelColor("Gasolina simples 98")).toBe("#a3e635");
    expect(fuelColor("Gasolina 98")).toBe("#a3e635");
  });

  it("keeps special petrol in the lime family", () => {
    expect(fuelColor("Gasolina especial 95")).toBe("#c9ef7a");
    expect(fuelColor("Gasolina especial 98")).toBe("#c9ef7a");
  });

  it("puts GPL and natural gas in blue", () => {
    expect(fuelColor("GPL Auto")).toBe("#3ea6ff");
    expect(fuelColor("GNC (gás natural comprimido) - €/m3")).toBe("#7cc4ff");
    expect(fuelColor("GNL (gás natural liquefeito) - €/kg")).toBe("#7cc4ff");
  });

  it("normalises accents and case", () => {
    expect(fuelColor("  GASOLEO SIMPLES  ")).toBe(fuelColor("Gasóleo simples"));
    expect(fuelColor("gasolina simples 95")).toBe(fuelColor("Gasolina simples 95"));
  });

  it("falls back for fuels outside the palette", () => {
    expect(fuelColor("Biodiesel B15")).toBe("#9ccc65");
    expect(fuelColor("Combustível do futuro")).toBe(FUEL_COLOR_FALLBACK);
  });
});

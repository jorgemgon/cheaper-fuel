import { describe, expect, it } from "vitest";

import {
  allProfileKeys,
  buildProfileOptions,
  channelLabel,
  combineLabel,
  confidenceLabel,
  programmeKindLabel,
  type ProfileOption,
} from "./discount-labels";

const OPTIONS: ProfileOption[] = [
  { key: "continente_card", label: "Cartão Continente", group: "card" },
  { key: "galp_energy", label: "Galp energia", group: "service" },
  { key: "lidl_plus", label: "App Lidl Plus", group: "card" },
  { key: "repsol_gas", label: "Repsol gás", group: "service" },
];

describe("allProfileKeys", () => {
  it("selects every card and service from the catalogue options", () => {
    expect(allProfileKeys(OPTIONS)).toEqual({
      cards: ["continente_card", "lidl_plus"],
      services: ["galp_energy", "repsol_gas"],
    });
  });

  it("handles an empty catalogue", () => {
    expect(allProfileKeys([])).toEqual({ cards: [], services: [] });
  });

  it("covers the fallback options when no programme needs are known", () => {
    const options = buildProfileOptions([]);
    const all = allProfileKeys(options);

    expect(all.cards).toContain("continente_card");
    expect(all.services).toEqual(
      expect.arrayContaining(["galp_energy", "galp_gas", "galp_solar", "nos_package"]),
    );
    expect(all.cards.length + all.services.length).toBeGreaterThan(5);
  });

  it("labels the COMBINA Galp services", () => {
    expect(buildProfileOptions([])).toEqual(
      expect.arrayContaining([
        { key: "galp_gas", label: "Gás natural Galp", group: "service" },
        { key: "galp_solar", label: "Painéis solares Galp", group: "service" },
      ]),
    );
  });
});

describe("catalogue labels", () => {
  it("translates programme kinds, confidence, channels and combines", () => {
    expect(programmeKindLabel("loyalty_tier")).toBe("Fidelização");
    expect(programmeKindLabel("card_partner")).toBe("Cartão parceiro");
    expect(confidenceLabel("high")).toBe("Confiança alta");
    expect(confidenceLabel("medium")).toBe("Confiança média");
    expect(channelLabel("coupon")).toBe("Cupão");
    expect(channelLabel("instant")).toBe("Desconto imediato");
    expect(combineLabel("sum")).toBe("Soma");
    expect(combineLabel("max")).toBe("Máximo");
  });
});

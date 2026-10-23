import { describe, expect, it } from "vitest";

import { allProfileKeys, buildProfileOptions, type ProfileOption } from "./discount-labels";

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
    expect(all.services).toContain("galp_energy");
    expect(all.cards.length + all.services.length).toBeGreaterThan(5);
  });
});

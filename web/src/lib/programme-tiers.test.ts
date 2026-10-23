import type { DiscountEntryInfo, DiscountProgrammeInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import { buildProgrammeTiers, buildTierLadders, formatTierValue, tierEffectivePrice } from "./programme-tiers";

function entry(overrides: Partial<DiscountEntryInfo> & { id: string }): DiscountEntryInfo {
  return {
    description: "",
    tier: null,
    tier_label: null,
    min_services: 0,
    channel: "app",
    value_type: "cents_per_litre",
    value: null,
    combine: "sum",
    caps: { litresPerFill: null, litresPerYear: null },
    requires: [],
    schedule: { kind: "always", weekdays: [], daysOfMonth: [], nth: null, weekday: null },
    valid_from: null,
    valid_until: null,
    status: "active",
    stale: false,
    source: { url: "", retrievedAt: "2026-10-23", contentHash: null, fetchMode: "manual", notes: null },
    ...overrides,
  };
}

function programme(
  id: string,
  discounts: DiscountEntryInfo[],
  overrides: Partial<DiscountProgrammeInfo> = {},
): DiscountProgrammeInfo {
  return {
    program_id: id,
    program_title: id.toUpperCase(),
    supplier: "GALP",
    partners: [],
    kind: "loyalty_tier",
    confidence: "high",
    status: "active",
    quantified: true,
    stale: false,
    discounts,
    ...overrides,
  };
}

describe("buildProgrammeTiers", () => {
  it("sums the app and coupon components of each COMBINA tier", () => {
    const tiers = buildProgrammeTiers(
      programme("galp-combina", [
        entry({ id: "1-app", tier: "combina-1", tier_label: "1 serviço", min_services: 1, value: 8 }),
        entry({ id: "1-coupon", tier: "combina-1", tier_label: "1 serviço", min_services: 1, value: 12 }),
        entry({ id: "2-app", tier: "combina-2", tier_label: "2 serviços", min_services: 2, value: 10 }),
        entry({ id: "2-coupon", tier: "combina-2", tier_label: "2 serviços", min_services: 2, value: 15 }),
        entry({ id: "3-app", tier: "combina-3", tier_label: "3+ serviços", min_services: 3, value: 10 }),
        entry({ id: "3-coupon", tier: "combina-3", tier_label: "3+ serviços", min_services: 3, value: 20 }),
      ]),
    );

    expect(tiers.map((tier) => [tier.label, tier.valueType, tier.value])).toEqual([
      ["1 serviço", "cents_per_litre", 20],
      ["2 serviços", "cents_per_litre", 25],
      ["3+ serviços", "cents_per_litre", 30],
    ]);
  });

  it("labels a tier with no catalogue label as Base", () => {
    const tiers = buildProgrammeTiers(
      programme("repsol-motor", [
        entry({ id: "base", tier: "", tier_label: "", min_services: 0, value: 8 }),
        entry({ id: "luz", tier: "motor-luz", tier_label: "Com eletricidade", min_services: 1, value: 13 }),
        entry({
          id: "luz-calor",
          tier: "motor-luz-calor",
          tier_label: "Com eletricidade e gás",
          min_services: 2,
          value: 18,
        }),
      ]),
    );

    expect(tiers.map((tier) => [tier.label, tier.value])).toEqual([
      ["Base", 8],
      ["Com eletricidade", 13],
      ["Com eletricidade e gás", 18],
    ]);
  });

  it("keeps a single euro-per-fill level instead of dropping it", () => {
    const tiers = buildProgrammeTiers(
      programme("bp-pingo-doce", [
        entry({ id: "bp", value_type: "eur_per_fill", value: 2 }),
      ]),
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ label: "Base", valueType: "eur_per_fill", value: 2 });
  });

  it("honours a max-combine tier and skips expired entries", () => {
    const tiers = buildProgrammeTiers(
      programme("mixed", [
        entry({ id: "a", tier: "t1", tier_label: "Base", min_services: 1, value: 5, combine: "max" }),
        entry({ id: "b", tier: "t1", tier_label: "Base", min_services: 1, value: 9, combine: "max" }),
        entry({ id: "c", tier: "t3", tier_label: "Old", min_services: 3, value: 20, status: "expired" }),
      ]),
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ id: "t1", value: 9 });
  });
});

describe("buildTierLadders", () => {
  it("keeps every programme, including single-level ones", () => {
    const ladders = buildTierLadders([
      programme("multi", [
        entry({ id: "1", tier: "t1", tier_label: "1", min_services: 1, value: 10 }),
        entry({ id: "2", tier: "t2", tier_label: "2", min_services: 2, value: 20 }),
      ]),
      programme("single", [entry({ id: "3", value: 5 })]),
    ]);

    expect([...ladders.keys()]).toEqual(["multi", "single"]);
    expect(ladders.get("multi")).toHaveLength(2);
    expect(ladders.get("single")).toHaveLength(1);
  });
});

describe("formatTierValue", () => {
  it("formats each unit", () => {
    const cents = buildProgrammeTiers(programme("c", [entry({ id: "a", value: 20 })]))[0];
    const euros = buildProgrammeTiers(
      programme("e", [entry({ id: "b", value_type: "eur_per_fill", value: 2 })]),
    )[0];
    const percent = buildProgrammeTiers(
      programme("p", [entry({ id: "c", value_type: "percent", value: 10 })]),
    )[0];

    expect(formatTierValue(cents)).toBe("20 cênt./L");
    expect(formatTierValue(euros).replace(/\s/g, " ")).toBe("2,00 € por abastecimento");
    expect(formatTierValue(percent)).toBe("10%");
  });
});

describe("tierEffectivePrice", () => {
  it("turns each service level into the price you would pay", () => {
    const base = 2.304;
    expect(tierEffectivePrice(base, { valueType: "cents_per_litre", value: 8 }, 50)).toBe(2.224);
    expect(tierEffectivePrice(base, { valueType: "cents_per_litre", value: 13 }, 50)).toBe(2.174);
    expect(tierEffectivePrice(base, { valueType: "cents_per_litre", value: 18 }, 50)).toBe(2.124);
  });

  it("handles COMBINA levels on a 2,120 €/L station", () => {
    expect(tierEffectivePrice(2.12, { valueType: "cents_per_litre", value: 20 }, 50)).toBe(1.92);
    expect(tierEffectivePrice(2.12, { valueType: "cents_per_litre", value: 30 }, 50)).toBe(1.82);
  });

  it("supports percent and per-fill couples", () => {
    expect(tierEffectivePrice(2.12, { valueType: "percent", value: 10 }, 50)).toBe(1.908);
    expect(tierEffectivePrice(2.12, { valueType: "eur_per_fill", value: 2 }, 50)).toBe(2.08);
    expect(tierEffectivePrice(2.12, { valueType: "eur_per_fill", value: 2 }, 100)).toBe(2.1);
  });

  it("never goes below zero and needs a base price", () => {
    expect(tierEffectivePrice(2, { valueType: "eur_per_fill", value: 200 }, 50)).toBe(0);
    expect(tierEffectivePrice(null, { valueType: "cents_per_litre", value: 10 }, 50)).toBeNull();
    expect(tierEffectivePrice(2.12, { valueType: "cents_per_litre", value: 10 }, 0)).toBeNull();
  });
});

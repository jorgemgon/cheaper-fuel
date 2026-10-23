import type { DiscountEntryInfo, DiscountProgrammeInfo } from "@contracts";
import { describe, expect, it } from "vitest";

import { buildProgrammeTiers, buildTierLadders } from "./programme-tiers";

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

    expect(tiers.map((tier) => [tier.label, tier.cents])).toEqual([
      ["1 serviço", 20],
      ["2 serviços", 25],
      ["3+ serviços", 30],
    ]);
  });

  it("honours a max-combine tier and skips entries without cents", () => {
    const tiers = buildProgrammeTiers(
      programme("mixed", [
        entry({ id: "a", tier: "t1", tier_label: "Base", min_services: 1, value: 5, combine: "max" }),
        entry({ id: "b", tier: "t1", tier_label: "Base", min_services: 1, value: 9, combine: "max" }),
        entry({ id: "c", tier: "t2", tier_label: "Top", min_services: 2, value_type: "percent", value: 10 }),
        entry({ id: "d", tier: "t3", tier_label: "Old", min_services: 3, value: 20, status: "expired" }),
      ]),
    );

    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ id: "t1", cents: 9 });
  });
});

describe("buildTierLadders", () => {
  it("keeps only programmes with more than one tier", () => {
    const ladders = buildTierLadders([
      programme("multi", [
        entry({ id: "1", tier: "t1", tier_label: "1", min_services: 1, value: 10 }),
        entry({ id: "2", tier: "t2", tier_label: "2", min_services: 2, value: 20 }),
      ]),
      programme("single", [entry({ id: "3", value: 5 })]),
    ]);

    expect([...ladders.keys()]).toEqual(["multi"]);
    expect(ladders.get("multi")).toHaveLength(2);
  });
});

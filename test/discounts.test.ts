import { describe, expect, it } from "vitest";

import {
  groupProgrammes,
  resolveForStation,
  sanitizeProfile,
  type StationLike,
} from "../src/discounts";
import { discountSchema, discountStatus, nextScheduleDate, scheduleMatches, type Discount } from "../src/discount-schema";

const TODAY = "2026-10-23";

function makeDiscount(overrides: Partial<Discount> & { id: string }): Discount {
  return discountSchema.parse({
    schemaVersion: 1,
    programId: "test-program",
    programTitle: "Test programme",
    description: "Test discount used by the unit tests.",
    tierId: null,
    tierLabel: null,
    tierRank: 0,
    kind: "loyalty_tier",
    supplier: "GALP",
    partners: [],
    stationMatch: { brands: ["GALP"], namePrefixes: [] },
    requires: [],
    minServices: 0,
    channel: "app",
    valueType: "cents_per_litre",
    value: 10,
    combine: "sum",
    caps: { litresPerFill: null, litresPerYear: null },
    schedule: { kind: "always", weekdays: [], daysOfMonth: [], nth: null, weekday: null },
    validFrom: null,
    validUntil: null,
    confidence: "high",
    source: {
      url: "https://example.com/source",
      retrievedAt: "2026-10-23",
      contentHash: null,
      fetchMode: "auto",
      notes: null,
    },
    updatedAt: "2026-10-23",
    ...overrides,
  });
}

const galpStation: StationLike = { brand: "GALP", name: "Galp Leiria", price: 2 };
const profile = sanitizeProfile({ cards: ["continua_card"], fillLitres: 50 });

describe("discountStatus", () => {
  it("derives status from the validity window", () => {
    expect(discountStatus({ validFrom: null, validUntil: null }, TODAY)).toBe("active");
    expect(discountStatus({ validFrom: "2026-01-01", validUntil: null }, TODAY)).toBe("active");
    expect(discountStatus({ validFrom: "2026-11-01", validUntil: null }, TODAY)).toBe("scheduled");
    expect(discountStatus({ validFrom: null, validUntil: "2026-06-30" }, TODAY)).toBe("expired");
  });

  it("treats both window endpoints as inclusive", () => {
    expect(discountStatus({ validFrom: TODAY, validUntil: TODAY }, TODAY)).toBe("active");
    expect(discountStatus({ validFrom: null, validUntil: TODAY }, TODAY)).toBe("active");
  });
});

describe("resolveForStation", () => {
  it("applies a quantified high-confidence programme", () => {
    const outcome = resolveForStation([makeDiscount({ id: "a" })], galpStation, "litro", profile, TODAY);
    expect(outcome.applied?.appliedCents).toBe(10);
    expect(outcome.applied?.effectivePriceEur).toBeCloseTo(1.9, 3);
    expect(outcome.applied?.savesEurPerFill).toBeCloseTo(5, 3);
  });

  it("never applies medium-confidence programmes to the price", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "a", confidence: "medium" })],
      galpStation,
      "litro",
      profile,
      TODAY,
    );
    expect(outcome.applied).toBeNull();
    expect(outcome.possible).toHaveLength(1);
  });

  it("ignores expired programmes but keeps them out of the outcome", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "a", validFrom: "2026-05-18", validUntil: "2026-06-30" })],
      galpStation,
      "litro",
      profile,
      TODAY,
    );
    expect(outcome.applied).toBeNull();
    expect(outcome.possible).toHaveLength(0);
  });

  it("combines app and coupon components in best_case mode", () => {
    const rows = [
      makeDiscount({ id: "app", programId: "combo", tierId: "t2", channel: "app", value: 10 }),
      makeDiscount({ id: "coupon", programId: "combo", tierId: "t2", channel: "coupon", value: 15 }),
    ];

    const best = resolveForStation(rows, galpStation, "litro", profile, TODAY);
    expect(best.applied?.appliedCents).toBe(25);
    expect(best.applied?.guaranteedCents).toBe(10);
    expect(best.applied?.maxCents).toBe(25);

    const guaranteedProfile = sanitizeProfile({ cards: ["continua_card"], mode: "guaranteed" });
    const guaranteed = resolveForStation(rows, galpStation, "litro", guaranteedProfile, TODAY);
    expect(guaranteed.applied?.appliedCents).toBe(10);
  });

  it("picks the highest tier the user qualifies for", () => {
    const rows = [
      makeDiscount({ id: "t1", programId: "combo", tierId: "t1", minServices: 1, value: 8 }),
      makeDiscount({ id: "t3", programId: "combo", tierId: "t3", minServices: 3, value: 30 }),
    ];

    const twoServices = sanitizeProfile({ cards: [], services: ["galp_energy", "nos_package"] });
    const outcome = resolveForStation(rows, galpStation, "litro", twoServices, TODAY);
    expect(outcome.applied?.tierId).toBe("t1");

    const threeServices = sanitizeProfile({
      cards: [],
      services: ["galp_energy", "nos_package", "solar"],
    });
    const top = resolveForStation(rows, galpStation, "litro", threeServices, TODAY);
    expect(top.applied?.tierId).toBe("t3");
  });

  it("reports missing cards instead of silently dropping the programme", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "a", requires: ["mundo_galp_app"] })],
      galpStation,
      "litro",
      sanitizeProfile({}),
      TODAY,
    );
    expect(outcome.applied).toBeNull();
    expect(outcome.locked).toHaveLength(1);
    expect(outcome.locked[0].missingRequires).toEqual(["mundo_galp_app"]);
  });

  it("applies per-fill caps to the savings", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "a", channel: "coupon", value: 20, caps: { litresPerFill: 30, litresPerYear: null } })],
      galpStation,
      "litro",
      sanitizeProfile({ fillLitres: 60 }),
      TODAY,
    );
    // 20 c/L on 30 L out of a 60 L fill => 6 EUR saved => 3.0 EUR effective discount per litre.
    expect(outcome.applied?.savesEurPerFill).toBeCloseTo(6, 3);
    expect(outcome.applied?.effectivePriceEur).toBeCloseTo(1.9, 3);
  });

  it("converts percent and eur_per_fill values to cents per litre", () => {
    const percent = resolveForStation(
      [makeDiscount({ id: "pct", valueType: "percent", value: 5, channel: "instant" })],
      { brand: "GALP", name: "Galp", price: 2 },
      "litro",
      profile,
      TODAY,
    );
    expect(percent.applied?.appliedCents).toBeCloseTo(10, 3);

    const perFill = resolveForStation(
      [makeDiscount({ id: "fill", valueType: "eur_per_fill", value: 5 })],
      { brand: "GALP", name: "Galp", price: 2 },
      "litro",
      sanitizeProfile({ fillLitres: 50 }),
      TODAY,
    );
    expect(perFill.applied?.appliedCents).toBeCloseTo(10, 3);
  });

  it("satisfies requirements from declared services as well as cards", () => {
    const outcome = resolveForStation(
      [
        makeDiscount({
          id: "repsol-luz",
          programId: "repsol-motor",
          tierId: "motor-luz",
          minServices: 1,
          value: 13,
          requires: ["repsol_partner_card", "repsol_electricity"],
          stationMatch: { brands: ["REPSOL"], namePrefixes: [] },
        }),
      ],
      { brand: "REPSOL", name: "Repsol Leiria", price: 2 },
      "litro",
      sanitizeProfile({ cards: ["repsol_partner_card"], services: ["repsol_electricity"] }),
      TODAY,
    );

    expect(outcome.applied?.appliedCents).toBe(13);
    expect(outcome.applied?.tierId).toBe("motor-luz");
  });

  it("falls back to a lower tier when a higher tier's requirements are unmet", () => {
    const rows = [
      makeDiscount({
        id: "base",
        programId: "repsol-motor",
        tierId: "motor",
        minServices: 0,
        value: 8,
        requires: ["repsol_partner_card"],
      }),
      makeDiscount({
        id: "luz-calor",
        programId: "repsol-motor",
        tierId: "motor-luz-calor",
        minServices: 2,
        value: 18,
        requires: ["repsol_partner_card", "repsol_electricity", "repsol_gas"],
      }),
    ];

    const outcome = resolveForStation(
      rows,
      { brand: "GALP", name: "Galp", price: 2 },
      "litro",
      sanitizeProfile({ cards: ["repsol_partner_card"], services: ["repsol_electricity", "x"] }),
      TODAY,
    );

    // Two services would qualify for the top tier by count, but the gas contract is missing.
    expect(outcome.applied?.tierId).toBe("motor");
  });

  it("matches franchises by name prefix when the brand is generic", () => {
    const discount = makeDiscount({
      id: "a",
      stationMatch: { brands: ["GALP"], namePrefixes: ["Galp-"] },
    });
    const outcome = resolveForStation(
      [discount],
      { brand: "Genérico", name: "Galp-OFIMAQ- Pousos_Leiria", price: 2 },
      "litro",
      profile,
      TODAY,
    );
    expect(outcome.applied).not.toBeNull();
  });

  it("does not apply per-litre discounts to kg or m3 fuels", () => {
    const outcome = resolveForStation([makeDiscount({ id: "a" })], galpStation, "kg", profile, TODAY);
    expect(outcome.applied).toBeNull();
    expect(outcome.possible).toHaveLength(0);
  });

  it("catalogues programmes that have no quantified value", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "b", valueType: null, value: null, confidence: "medium" })],
      galpStation,
      "litro",
      profile,
      TODAY,
    );
    expect(outcome.applied).toBeNull();
    expect(outcome.catalogued).toHaveLength(1);
  });

  it("flags stale provenance", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "a", source: { url: "https://example.com", retrievedAt: "2026-01-01", contentHash: null, fetchMode: "auto", notes: null } })],
      galpStation,
      "litro",
      profile,
      TODAY,
    );
    expect(outcome.applied?.stale).toBe(true);
  });

  it("prefers the larger saving when two programmes match", () => {
    const outcome = resolveForStation(
      [
        makeDiscount({ id: "small", programId: "a", value: 5 }),
        makeDiscount({ id: "big", programId: "b", value: 20 }),
      ],
      galpStation,
      "litro",
      profile,
      TODAY,
    );
    expect(outcome.applied?.programId).toBe("b");
    expect(outcome.possible).toHaveLength(1);
  });
});

describe("schedule", () => {
  const firstWednesday = {
    kind: "nth_weekday_of_month" as const,
    weekdays: [],
    daysOfMonth: [],
    nth: 1,
    weekday: 3,
  };

  it("matches the configured day-of-week and day-of-month rules", () => {
    expect(scheduleMatches(firstWednesday, "2026-10-07")).toBe(true);
    expect(scheduleMatches(firstWednesday, "2026-10-14")).toBe(false);
    expect(
      scheduleMatches({ kind: "weekdays", weekdays: [6, 7], daysOfMonth: [], nth: null, weekday: null }, "2026-10-24"),
    ).toBe(true);
    expect(
      scheduleMatches({ kind: "day_of_month", weekdays: [], daysOfMonth: [15], nth: null, weekday: null }, "2026-10-15"),
    ).toBe(true);
    expect(
      scheduleMatches({ kind: "always", weekdays: [], daysOfMonth: [], nth: null, weekday: null }, "2026-10-23"),
    ).toBe(true);
  });

  it("finds the next date the schedule allows", () => {
    expect(nextScheduleDate(firstWednesday, "2026-10-23")).toBe("2026-11-04");
    expect(nextScheduleDate(firstWednesday, "2026-10-07")).toBe("2026-10-07");
  });

  it("keeps day-restricted offers out of the price and reports them", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "wed", schedule: firstWednesday })],
      galpStation,
      "litro",
      profile,
      "2026-10-23",
    );

    expect(outcome.applied).toBeNull();
    expect(outcome.scheduled).toHaveLength(1);
    expect(outcome.scheduled[0].nextDate).toBe("2026-11-04");
    expect(outcome.scheduled[0].scheduleLabel).toBe("first Wednesday of each month");
  });

  it("applies the offer when the schedule matches today", () => {
    const outcome = resolveForStation(
      [makeDiscount({ id: "wed", schedule: firstWednesday })],
      galpStation,
      "litro",
      profile,
      "2026-10-07",
    );

    expect(outcome.applied?.appliedCents).toBe(10);
    expect(outcome.scheduled).toHaveLength(0);
  });
});

describe("groupProgrammes", () => {
  it("groups by programme and derives status once", () => {
    const groups = groupProgrammes(
      [
        makeDiscount({ id: "a1", programId: "p1", tierId: "t1" }),
        makeDiscount({ id: "a2", programId: "p1", tierId: "t2" }),
        makeDiscount({
          id: "b1",
          programId: "p2",
          validFrom: "2026-05-18",
          validUntil: "2026-06-30",
        }),
      ],
      TODAY,
    );

    expect(groups).toHaveLength(2);
    const first = groups.find((group) => group.programId === "p1");
    expect(first?.discounts).toHaveLength(2);
    expect(first?.status).toBe("active");
    const second = groups.find((group) => group.programId === "p2");
    expect(second?.status).toBe("expired");
  });
});

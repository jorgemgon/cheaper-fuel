import { describe, expect, it } from "vitest";

import seed from "../data/discounts.seed.json";
import { discountSchema, discountStatus, type Discount } from "../src/discount-schema";

const raw = (seed as { discounts: unknown[] }).discounts;
const parsed = raw.map((entry) => discountSchema.parse(entry)) as Discount[];
const today = new Date().toISOString().slice(0, 10);

describe("discount seed", () => {
  it("validates every entry against the standardized schema", () => {
    expect(parsed.length).toBeGreaterThan(0);
    for (const entry of raw) {
      expect(() => discountSchema.parse(entry)).not.toThrow();
    }
  });

  it("uses unique ids", () => {
    const ids = parsed.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every validity window ordered", () => {
    for (const entry of parsed) {
      if (entry.validFrom && entry.validUntil) {
        expect(entry.validFrom <= entry.validUntil, `${entry.id} has an inverted window`).toBe(true);
      }
    }
  });

  it("never sets valueType without a value (or vice versa)", () => {
    for (const entry of parsed) {
      expect(entry.valueType === null).toBe(entry.value === null);
    }
  });

  it("has at least one quantified programme for Galp", () => {
    const galp = parsed.filter((entry) => entry.supplier === "GALP" && entry.valueType !== null);
    expect(galp.length).toBeGreaterThan(0);
  });

  it("keeps an expired campaign as a fixture", () => {
    const expired = parsed.filter((entry) => discountStatus(entry, today) === "expired");
    expect(expired.length).toBeGreaterThan(0);
  });

  it("gives every discount a human-readable description", () => {
    for (const entry of parsed) {
      expect(entry.description.length, `${entry.id} needs a description`).toBeGreaterThan(20);
    }
  });

  it("models the recurring first-Wednesday offer with a schedule", () => {
    const intermarche = parsed.find((entry) => entry.programId === "intermarche-first-wednesday");
    expect(intermarche?.schedule.kind).toBe("nth_weekday_of_month");
    expect(intermarche?.schedule.weekday).toBe(3);
    expect(intermarche?.schedule.nth).toBe(1);
    // Unverified against an official page, so it must never move a price.
    expect(intermarche?.confidence).toBe("medium");
  });

  it("defaults every other programme to an always-on schedule", () => {
    const others = parsed.filter((entry) => entry.programId !== "intermarche-first-wednesday");
    for (const entry of others) {
      expect(entry.schedule.kind, `${entry.id} should be always-on`).toBe("always");
    }
  });

  it("models the Lidl Plus × Repsol campaign from its regulation", () => {
    const lidl = parsed.filter((entry) => entry.programId === "repsol-lidl-plus");
    expect(lidl).toHaveLength(3);
    expect(lidl.every((entry) => entry.confidence === "high")).toBe(true);
    expect(
      lidl.every((entry) => entry.validFrom === "2026-01-01" && entry.validUntil === "2026-12-31"),
    ).toBe(true);

    const linkedTotal = lidl
      .filter((entry) => entry.tierId === "linked")
      .reduce((total, entry) => total + (entry.value ?? 0), 0);
    expect(linkedTotal).toBe(10);
    expect(lidl.find((entry) => entry.tierId === "app-only")?.value).toBe(6);
  });

  it("quantifies the Repsol tiers from the official benefits table", () => {
    const repsol = parsed.filter((entry) => entry.programId === "repsol-motor");
    expect(repsol).toHaveLength(3);
    expect(repsol.every((entry) => entry.confidence === "high")).toBe(true);
    expect(repsol.every((entry) => entry.valueType === "cents_per_litre")).toBe(true);
    expect(repsol.map((entry) => entry.value ?? 0).sort((a, b) => a - b)).toEqual([8, 13, 18]);
  });

  it("quantifies the BP Poupa Mais partnership", () => {
    const bp = parsed.find((entry) => entry.programId === "bp-pingo-doce");
    expect(bp?.valueType).toBe("eur_per_fill");
    expect(bp?.value).toBe(2);
    expect(bp?.confidence).toBe("high");
    expect(bp?.requires).toContain("poupa_mais_card");
  });

  it("refreshes provenance before it goes stale for still-applicable programmes", () => {
    for (const entry of parsed) {
      if (discountStatus(entry, today) === "expired") continue;
      const ageDays = (Date.parse(today) - Date.parse(entry.source.retrievedAt)) / 86_400_000;
      expect(
        ageDays,
        `${entry.id}: source retrieved ${entry.source.retrievedAt}; re-verify it and update retrievedAt`,
      ).toBeLessThanOrEqual(90);
    }
  });
});

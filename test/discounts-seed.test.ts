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

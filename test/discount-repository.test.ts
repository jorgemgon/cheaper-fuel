import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDiscounts, resetDiscountCache } from "../src/discounts";
import type { Env } from "../src/env";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "galp-test",
    schema_version: 1,
    program_id: "galp-test",
    program_title: "Test",
    description: "A test discount used by the repository tests.",
    tier_id: null,
    tier_label: null,
    tier_rank: 0,
    kind: "loyalty_tier",
    supplier: "GALP",
    partners_json: '["CONTINENTE"]',
    brands_json: '["GALP"]',
    name_prefixes_json: "[]",
    requires_json: '["continente_card"]',
    min_services: 0,
    channel: "app",
    value_type: "cents_per_litre",
    value: 10,
    combine: "sum",
    cap_litres_per_fill: null,
    cap_litres_per_year: 7000,
    schedule_kind: "always",
    schedule_weekdays_json: "[]",
    schedule_days_of_month_json: "[]",
    schedule_nth: null,
    schedule_weekday: null,
    valid_from: null,
    valid_until: null,
    confidence: "high",
    source_url: "https://example.com/source",
    source_retrieved_at: "2026-10-23",
    source_hash: null,
    source_fetch_mode: "auto",
    notes: null,
    updated_at: "2026-10-23",
    ...overrides,
  };
}

function dbWith(rows: Record<string, unknown>[]): { db: D1Database; calls: () => number } {
  let calls = 0;
  const db = {
    prepare: () => ({
      all: async () => {
        calls += 1;
        return { results: rows };
      },
    }),
  } as unknown as D1Database;
  return { db, calls: () => calls };
}

beforeEach(() => {
  resetDiscountCache();
});

describe("loadDiscounts", () => {
  it("maps D1 rows onto the standardized object", async () => {
    const { db } = dbWith([row()]);
    const loaded = await loadDiscounts({ DB: db } as Env);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.discounts).toHaveLength(1);
    expect(loaded.discounts[0]).toMatchObject({
      id: "galp-test",
      supplier: "GALP",
      partners: ["CONTINENTE"],
      stationMatch: { brands: ["GALP"], namePrefixes: [] },
      requires: ["continente_card"],
      value: 10,
    });
    expect(loaded.updatedAt).toBe("2026-10-23");
  });

  it("degrades when the binding is absent", async () => {
    const loaded = await loadDiscounts({} as Env);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toMatch(/DB/);
  });

  it("degrades when the query throws", async () => {
    const db = {
      prepare: () => ({
        all: async () => {
          throw new Error("no such table: discounts");
        },
      }),
    } as unknown as D1Database;

    const loaded = await loadDiscounts({ DB: db } as Env);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toMatch(/no such table/);
  });

  it("skips rows that fail validation instead of failing the whole load", async () => {
    const { db } = dbWith([row(), row({ id: "broken", value_type: null, value: 10 })]);
    const loaded = await loadDiscounts({ DB: db } as Env);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.discounts.map((discount) => discount.id)).toEqual(["galp-test"]);
  });

  it("memoises successful reads per isolate", async () => {
    const { db, calls } = dbWith([row()]);
    await loadDiscounts({ DB: db } as Env);
    await loadDiscounts({ DB: db } as Env);
    expect(calls()).toBe(1);
  });

  it("does not memoise failures", async () => {
    const probe = vi.fn(async () => {
      throw new Error("temporary");
    });
    const db = { prepare: () => ({ all: probe }) } as unknown as D1Database;

    await loadDiscounts({ DB: db } as Env);
    await loadDiscounts({ DB: db } as Env);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

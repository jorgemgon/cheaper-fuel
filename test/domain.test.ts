import { describe, expect, it } from "vitest";

import {
  addDaysIso,
  buildDateRange,
  formatPrice,
  fuelAlias,
  isWithinHours,
  levenshtein,
  matchByName,
  normalizeText,
  parseDgegTimestamp,
  parsePrice,
  parseUnit,
  summarize,
} from "../src/domain";

describe("normalizeText", () => {
  it("strips diacritics, case and punctuation", () => {
    expect(normalizeText("Évora")).toBe("evora");
    expect(normalizeText("  Marinha   Grande ")).toBe("marinha grande");
    expect(normalizeText("Área comercial (Hipermercados)")).toBe("area comercial hipermercados");
  });
});

describe("parsePrice", () => {
  it("parses DGEG price strings", () => {
    expect(parsePrice("2,014 €")).toBeCloseTo(2.014, 4);
    expect(parsePrice("2,118 €/litro")).toBeCloseTo(2.118, 4);
    expect(parsePrice("0,898 €")).toBeCloseTo(0.898, 4);
  });

  it("handles thousands separators and plain numbers", () => {
    expect(parsePrice("1.234,50 €")).toBeCloseTo(1234.5, 2);
    expect(parsePrice(1.929)).toBeCloseTo(1.929, 4);
  });

  it("rejects empty and malformed values", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("n/d")).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
});

describe("parseUnit", () => {
  it("extracts the unit from DGEG price strings", () => {
    expect(parseUnit("2,118 €/litro")).toBe("litro");
    expect(parseUnit("12,345 €/kg")).toBe("kg");
    expect(parseUnit("1,2 €/m³")).toBe("m3");
    expect(parseUnit("2,014 €")).toBeNull();
  });
});

describe("formatPrice", () => {
  it("renders pt-PT style prices", () => {
    expect(formatPrice(1.929, "litro")).toBe("1,929 €/litro");
    expect(formatPrice(2, null)).toBe("2,000 €");
    expect(formatPrice(null)).toBeNull();
  });
});

describe("summarize", () => {
  it("computes min, max, average and median", () => {
    expect(summarize([2, 1, 3])).toEqual({ count: 3, min: 1, max: 3, avg: 2, median: 2 });
    expect(summarize([1, 2, 3, 4])?.median).toBe(2.5);
  });

  it("returns null for no data", () => {
    expect(summarize([])).toBeNull();
  });
});

describe("date helpers", () => {
  it("parses DGEG wall-clock timestamps", () => {
    expect(parseDgegTimestamp("2026-10-20 08:00")).toBe(Date.UTC(2026, 9, 20, 8, 0));
    expect(parseDgegTimestamp("2026-10-20")).toBe(Date.UTC(2026, 9, 20));
    expect(parseDgegTimestamp("not a date")).toBeNull();
  });

  it("bounds updated_within_hours using Lisbon wall clock", () => {
    const now = new Date("2026-10-21T07:00:00Z"); // 08:00 in Lisbon (WEST)
    expect(isWithinHours("2026-10-20 08:00", 24, now)).toBe(true);
    expect(isWithinHours("2026-10-20 07:00", 24, now)).toBe(false);
    expect(isWithinHours("", 24, now)).toBe(false);
  });

  it("adds days in UTC", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("defaults to 30 days and clamps to 365", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    const range = buildDateRange({ now });
    expect(range.to).toBe("2026-10-23");
    expect(range.from).toBe("2026-09-24");

    const clamped = buildDateRange({ days: 5000, now });
    expect(clamped.from).toBe("2025-10-24");
  });

  it("ignores future end dates and never returns from > to", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    const range = buildDateRange({ from: "2026-12-01", to: "2027-01-01", now });
    expect(range.to).toBe("2026-10-23");
    expect(range.from <= range.to).toBe(true);
  });
});

describe("levenshtein", () => {
  it("measures edit distance", () => {
    expect(levenshtein("leiria", "leiria")).toBe(0);
    expect(levenshtein("leiria", "leirria")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("matchByName", () => {
  const items = [
    { id: 1, name: "Leiria" },
    { id: 2, name: "Lisboa" },
    { id: 3, name: "Marinha Grande" },
  ];
  const name = (item: { name: string }) => item.name;

  it("matches exactly and case-insensitively", () => {
    expect(matchByName(items, "leiria", name).match?.id).toBe(1);
    expect(matchByName(items, "MARINHA GRANDE", name).match?.id).toBe(3);
  });

  it("matches a unique substring", () => {
    expect(matchByName(items, "marinha", name).match?.id).toBe(3);
  });

  it("corrects a small typo", () => {
    expect(matchByName(items, "leirria", name).match?.id).toBe(1);
  });

  it("reports ambiguity instead of guessing", () => {
    const duplicated = [
      { id: 1, name: "Santa Catarina" },
      { id: 2, name: "Santa Catarina" },
    ];
    const result = matchByName(duplicated, "Santa Catarina", name);
    expect(result.match).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it("returns nothing for unrelated input", () => {
    expect(matchByName(items, "zzzzz", name).match).toBeNull();
  });

  it("supports aliases", () => {
    const fuels = [
      { id: 3201, name: "Gasolina simples 95" },
      { id: 2101, name: "Gasóleo simples" },
    ];
    const result = matchByName(fuels, "diesel", (fuel) => fuel.name, { alias: fuelAlias });
    expect(result.match?.id).toBe(2101);
  });
});

describe("fuelAlias", () => {
  it("maps common nicknames to DGEG names", () => {
    expect(fuelAlias("diesel")).toBe("gasoleo simples");
    expect(fuelAlias("95")).toBe("gasolina simples 95");
    expect(fuelAlias("gpl")).toBe("gpl auto");
    expect(fuelAlias("gasoleo especial")).toBe("gasoleo especial");
  });
});

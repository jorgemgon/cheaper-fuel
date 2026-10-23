import { describe, expect, it } from "vitest";

import {
  formatCents,
  formatDate,
  formatKm,
  formatMoney,
  formatPrice,
  formatRelativeTime,
  parseDgegDate,
} from "./format";

describe("formatPrice", () => {
  it("renders pt-PT prices with the right unit suffix", () => {
    expect(formatPrice(1.929, "litro")).toBe("1,929 €/litro");
    expect(formatPrice(2.1, "kg")).toBe("2,100 €/kg");
    expect(formatPrice(1.5, "m3")).toBe("1,500 €/m³");
    expect(formatPrice(2.014)).toBe("2,014 €");
  });

  it("renders an em dash for missing prices", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(undefined, "litro")).toBe("—");
  });
});

describe("formatMoney", () => {
  it("formats euros with two decimals", () => {
    expect(formatMoney(12.5)).toContain("12,50");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("formatKm", () => {
  it("formats distances with one decimal", () => {
    expect(formatKm(2.82)).toBe("2,8 km");
    expect(formatKm(null)).toBe("—");
  });
});

describe("formatCents", () => {
  it("formats integer and fractional cent values", () => {
    expect(formatCents(20)).toBe("20 cênt./L");
    expect(formatCents(3.5)).toBe("3,5 cênt./L");
    expect(formatCents(null)).toBe("—");
  });
});

describe("parseDgegDate", () => {
  it("parses DGEG wall-clock timestamps", () => {
    const parsed = parseDgegDate("2026-10-20 08:00");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
  });

  it("returns null for junk", () => {
    expect(parseDgegDate("")).toBeNull();
    expect(parseDgegDate("not a date")).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-23T12:00:00");

  it("describes recent timestamps in minutes and hours", () => {
    expect(formatRelativeTime("2026-10-23 11:55", now)).toBe("há 5 min");
    expect(formatRelativeTime("2026-10-23 09:00", now)).toBe("há 3 h");
  });

  it("describes older timestamps in days", () => {
    expect(formatRelativeTime("2026-10-21 12:00", now)).toBe("há 2 dias");
    expect(formatRelativeTime("2026-10-22 12:00", now)).toBe("há 1 dia");
  });

  it("handles missing values", () => {
    expect(formatRelativeTime(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it("renders dd/mm/yyyy", () => {
    expect(formatDate("2026-10-23")).toBe("23/10/2026");
    expect(formatDate(null)).toBe("—");
  });
});

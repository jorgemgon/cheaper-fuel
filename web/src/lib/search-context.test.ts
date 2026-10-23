import { describe, expect, it } from "vitest";

import { parseSearchContext } from "./search-context";

describe("parseSearchContext", () => {
  it("accepts a saved place", () => {
    expect(parseSearchContext({ mode: "place", location: "  Leiria ", at: "2026-10-23T10:00:00Z" })).toEqual({
      mode: "place",
      location: "Leiria",
      at: "2026-10-23T10:00:00Z",
    });
  });

  it("accepts saved coordinates for geo and picked searches", () => {
    expect(parseSearchContext({ mode: "picked", latitude: 39.74, longitude: -8.81 })).toEqual({
      mode: "picked",
      latitude: 39.74,
      longitude: -8.81,
      at: undefined,
    });
    expect(parseSearchContext({ mode: "geo", latitude: 39.74, longitude: -8.81 })?.mode).toBe("geo");
  });

  it("rejects incomplete or unknown contexts", () => {
    expect(parseSearchContext(null)).toBeNull();
    expect(parseSearchContext("Leiria")).toBeNull();
    expect(parseSearchContext({ mode: "place", location: "   " })).toBeNull();
    expect(parseSearchContext({ mode: "geo", latitude: 39.74 })).toBeNull();
    expect(parseSearchContext({ mode: "nearby", latitude: 1, longitude: 2 })).toBeNull();
    expect(parseSearchContext({ mode: "geo", latitude: "39", longitude: "-8" })).toBeNull();
  });
});

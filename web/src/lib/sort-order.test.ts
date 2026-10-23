import { describe, expect, it } from "vitest";

import { nextSortState } from "./sort-order";

describe("nextSortState", () => {
  it("starts a new sort key at its natural order", () => {
    expect(nextSortState({ sort: "distance", sortOrder: "desc" }, "price")).toEqual({
      sort: "price",
      sortOrder: "asc",
    });
    expect(nextSortState({ sort: "price", sortOrder: "desc" }, "distance")).toEqual({
      sort: "distance",
      sortOrder: "asc",
    });
  });

  it("switching to price always starts cheapest first", () => {
    expect(nextSortState({ sort: "distance", sortOrder: "asc" }, "price")).toEqual({
      sort: "price",
      sortOrder: "asc",
    });
    expect(nextSortState({ sort: "distance", sortOrder: "desc" }, "price")).toEqual({
      sort: "price",
      sortOrder: "asc",
    });
  });

  it("flips direction when the active key is pressed again", () => {
    expect(nextSortState({ sort: "price", sortOrder: "asc" }, "price")).toEqual({
      sort: "price",
      sortOrder: "desc",
    });
    expect(nextSortState({ sort: "price", sortOrder: "desc" }, "price")).toEqual({
      sort: "price",
      sortOrder: "asc",
    });
  });
});

import type { SortMode, SortOrder } from "../composables/useProfile";

export interface SortState {
  sort: SortMode;
  sortOrder: SortOrder;
}

/**
 * Clicking the active key flips its direction, like a table header. Choosing a
 * new key starts at the natural order: cheapest or nearest first.
 */
export function nextSortState(current: SortState, key: SortMode): SortState {
  if (current.sort === key) {
    return { sort: key, sortOrder: current.sortOrder === "desc" ? "asc" : "desc" };
  }
  return { sort: key, sortOrder: "asc" };
}

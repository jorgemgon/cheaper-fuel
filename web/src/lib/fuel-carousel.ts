/** Keeps the selected fuel across result updates, falling back to the first. */
export function resolveActiveFuel(
  fuels: readonly string[],
  current: string | null,
): string | null {
  if (fuels.length === 0) return null;
  if (current !== null && fuels.includes(current)) return current;
  return fuels[0];
}

/** Clamped index step for the carousel tabs and swipe gestures. */
export function stepFuelIndex(length: number, index: number, delta: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + delta));
}

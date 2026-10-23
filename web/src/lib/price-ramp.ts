export interface PriceRamp {
  colorFor(value: number | null | undefined): string;
  min: number | null;
  max: number | null;
  legend: Array<{ label: string; color: string }>;
}

const CHEAP: [number, number, number] = [70, 211, 154];
const MIDDLE: [number, number, number] = [240, 180, 41];
const DEAR: [number, number, number] = [255, 122, 122];
const UNKNOWN = "#8aa1b6";

function mix(from: [number, number, number], to: [number, number, number], t: number): string {
  const channel = (index: number) => Math.round(from[index] + (to[index] - from[index]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Maps a price onto a green → amber → red ramp. */
export function priceColor(value: number | null | undefined, min: number, max: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNKNOWN;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return mix(CHEAP, CHEAP, 0);

  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return ratio < 0.5
    ? mix(CHEAP, MIDDLE, ratio * 2)
    : mix(MIDDLE, DEAR, (ratio - 0.5) * 2);
}

export function buildPriceRamp(values: Array<number | null | undefined>): PriceRamp {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const min = known.length > 0 ? Math.min(...known) : null;
  const max = known.length > 0 ? Math.max(...known) : null;

  return {
    min,
    max,
    colorFor(value) {
      if (min === null || max === null) return UNKNOWN;
      return priceColor(value, min, max);
    },
    legend:
      min === null || max === null
        ? []
        : [
            { label: "mais barato", color: priceColor(min, min, max) },
            { label: "médio", color: priceColor((min + max) / 2, min, max) },
            { label: "mais caro", color: priceColor(max, min, max) },
          ],
  };
}

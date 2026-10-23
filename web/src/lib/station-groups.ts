import type { StationInfo } from "@contracts";

export interface StationFuelRow {
  station: StationInfo;
  fuel: string;
}

export interface StationGroup {
  /** The entry whose price colours the marker: the cheapest selected fuel. */
  station: StationInfo;
  fuels: Array<{ fuel: string; station: StationInfo }>;
}

/** Effective price when a discount applies, otherwise the list price. */
export function markerPrice(station: StationInfo): number | null {
  const value = station.discount?.effective_price_eur ?? station.price_eur;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One marker per physical station. Selecting several fuels must not put the
 * same place on the map twice and double the cluster counts, so rows collapse
 * per station and keep every selected fuel for the popup.
 */
export function groupRowsByStation(rows: readonly StationFuelRow[]): StationGroup[] {
  const byId = new Map<number, StationGroup>();

  for (const row of rows) {
    const entry = byId.get(row.station.id) ?? { station: row.station, fuels: [] };
    entry.fuels.push({ fuel: row.fuel, station: row.station });

    const current = markerPrice(entry.station);
    const candidate = markerPrice(row.station);
    if (candidate !== null && (current === null || candidate < current)) {
      entry.station = row.station;
    }
    byId.set(row.station.id, entry);
  }

  return [...byId.values()];
}

/** Prices in different units (€/litro, €/kg, €/m³) cannot share one ramp. */
export function hasMixedUnits(rows: readonly StationFuelRow[]): boolean {
  return new Set(rows.map((row) => row.station.unit)).size > 1;
}

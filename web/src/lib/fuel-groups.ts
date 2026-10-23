import type { FuelStationList } from "@contracts";

import { fuelColor } from "./fuel-colors";
import type { StationFuelRow } from "./station-groups";

export interface FuelGroup {
  fuel: string;
  unit: string | null;
  stationsFound: number;
  rows: StationFuelRow[];
  /** Identity colour shared with the fuel filter chip. */
  color: string;
}

/** One collapsible section per selected fuel, in the order the API returned. */
export function buildFuelGroups(fuels: readonly FuelStationList[]): FuelGroup[] {
  return fuels.map((fuel) => ({
    fuel: fuel.fuel,
    unit: fuel.unit,
    stationsFound: fuel.stations_found,
    rows: fuel.stations.map((station) => ({ station, fuel: fuel.fuel })),
    color: fuelColor(fuel.fuel),
  }));
}

/** "58 postos", or "20 de 84 postos" when the results limit truncated a fuel. */
export function fuelGroupCount(group: FuelGroup): string {
  return group.stationsFound > group.rows.length
    ? `${group.rows.length} de ${group.stationsFound} postos`
    : `${group.rows.length} postos`;
}

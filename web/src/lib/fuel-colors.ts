/**
 * Fuel identity colours for the dashboard. They are used on the fuel filter
 * chips and on the per-fuel collapsible headers — not on the map, whose
 * markers keep the cheap → dear price ramp.
 */

const DIESEL = "#f2c200";
const DIESEL_SPECIAL = "#f8dd75";
const DIESEL_MARKED = "#d9a400";
const PETROL = "#a3e635";
const PETROL_SPECIAL = "#c9ef7a";
const PETROL_MIX = "#8fbf3f";
const GPL = "#3ea6ff";
const NATURAL_GAS = "#7cc4ff";
const BIODIESEL = "#9ccc65";

/** Fuels outside the palette (or unknown to the catalogue) stay neutral. */
export const FUEL_COLOR_FALLBACK = "#8aa1b6";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Colour for a fuel name, accent- and case-insensitive. */
export function fuelColor(name: string): string {
  const key = normalize(name);

  if (key.startsWith("gasoleo")) {
    if (key.includes("especial")) return DIESEL_SPECIAL;
    if (key.includes("colorido")) return DIESEL_MARKED;
    return DIESEL;
  }

  if (key.startsWith("gasolina")) {
    if (key.includes("especial")) return PETROL_SPECIAL;
    if (key.includes("mistura")) return PETROL_MIX;
    // "Gasolina simples 95", "...98" and "Gasolina 98" share the same lime.
    return PETROL;
  }

  if (key.startsWith("gpl")) return GPL;
  if (key.startsWith("gnc") || key.startsWith("gnl")) return NATURAL_GAS;
  if (key.startsWith("biodiesel")) return BIODIESEL;

  return FUEL_COLOR_FALLBACK;
}

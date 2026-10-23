import type { StationInfo } from "@contracts";

import type { QuantityUnit } from "../composables/useProfile";
import { formatMoney, formatQuantity } from "./format";

const UNIT_SYMBOL: Record<string, string> = { litro: "L", kg: "kg", m3: "m³" };

/** Fuel unit label: litres, kilograms or cubic metres. */
export function unitSymbol(unit: string | null | undefined): string {
  if (!unit) return "L";
  return UNIT_SYMBOL[unit] ?? unit;
}

export interface FillEstimate {
  /** The chosen amount, e.g. "50 L" or "50,00 €". */
  quantityLabel: string;
  /** What the fill costs at the card's price. */
  spendLabel: string;
  /** Fuel obtained, e.g. "27,5 L". */
  litresLabel: string;
  /** "poupas 15,00 €", or null when there is no discount. */
  savingsLabel: string | null;
}

/**
 * Spend and saving for the chosen quantity, at the card's headline price.
 * In litres mode the quantity is fixed; in euros mode the budget is fixed and
 * the litres follow from the price.
 */
export function fillEstimate(
  station: StationInfo,
  quantity: number,
  quantityUnit: QuantityUnit,
): FillEstimate | null {
  const base = station.price_eur;
  const effective = station.discount?.effective_price_eur ?? base;
  if (base === null || effective === null || !Number.isFinite(effective) || effective <= 0) {
    return null;
  }

  const symbol = unitSymbol(station.unit);
  const litres = quantityUnit === "litres" ? quantity : quantity / effective;
  const spend = quantityUnit === "litres" ? quantity * effective : quantity;
  const savings = Math.max(0, litres * (base - effective));

  return {
    quantityLabel:
      quantityUnit === "litres" ? `${formatQuantity(quantity)} ${symbol}` : formatMoney(quantity),
    spendLabel: formatMoney(spend),
    litresLabel: `${formatQuantity(litres)} ${symbol}`,
    savingsLabel: savings > 0.005 ? `poupas ${formatMoney(savings)}` : null,
  };
}

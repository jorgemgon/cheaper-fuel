import type { StationInfo } from "@contracts";

import { formatCents, formatPrice } from "./format";

export interface PriceOption {
  key: string;
  label: string;
  priceDisplay: string;
  priceEur: number;
  /** The catalogue value still needs confirming at the pump. */
  unconfirmed: boolean;
}

/**
 * The headline is the best price the station can reach for this fuel. Every
 * other price the caller could pay is listed separately, so the card never
 * depends on a "best case / guaranteed only" switch.
 */
export function bestPriceDisplay(station: StationInfo): string {
  return station.discount?.effective_price_display ?? station.price_display ?? "—";
}

function roundPrice(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function remainingPriceOptions(station: StationInfo): PriceOption[] {
  const options: PriceOption[] = [];
  const unit = station.unit;

  for (const entry of station.possible_discounts ?? []) {
    const price = entry.effective_price_eur;
    if (price === null || !Number.isFinite(price)) continue;
    options.push({
      key: `programme:${entry.program_id}`,
      label: entry.label ? `${entry.program_title} · ${entry.label}` : entry.program_title,
      priceDisplay: entry.effective_price_display ?? formatPrice(price, unit),
      priceEur: price,
      unconfirmed: entry.confidence !== "high",
    });
  }

  const discount = station.discount;
  const base = station.price_eur;
  if (discount && base !== null) {
    // The guaranteed slice of the applied programme is a different price from
    // the best case, which may rely on a spend-triggered coupon.
    if (discount.guaranteed_cents > 0 && discount.guaranteed_cents < discount.applied_cents) {
      const guaranteed = roundPrice(base - discount.guaranteed_cents / 100);
      options.push({
        key: "guaranteed",
        label: `Garantido · ${formatCents(discount.guaranteed_cents)}`,
        priceDisplay: formatPrice(guaranteed, unit),
        priceEur: guaranteed,
        unconfirmed: false,
      });
    }
    options.push({
      key: "base",
      label: "Sem desconto",
      priceDisplay: station.price_display ?? formatPrice(base, unit),
      priceEur: base,
      unconfirmed: false,
    });
  }

  return options.sort((a, b) => a.priceEur - b.priceEur);
}

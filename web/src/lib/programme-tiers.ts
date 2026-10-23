import type { DiscountInfo } from "@contracts";

import { formatCents, formatMoney, formatQuantity } from "./format";

export type TierValueType = "cents_per_litre" | "eur_per_fill" | "percent";

export interface ProgrammeTier {
  id: string;
  label: string;
  minServices: number;
  valueType: TierValueType;
  value: number;
}

/**
 * The levels the server resolved for this station, or the applied level when
 * an older cached payload has no `levels` array.
 */
export function tiersForDiscount(discount: DiscountInfo | undefined): ProgrammeTier[] {
  if (!discount) return [];

  const fromServer: ProgrammeTier[] = [];
  for (const level of discount.levels ?? []) {
    if (level.value_type === null) continue;
    fromServer.push({
      id: level.tier ?? `level-${level.min_services}`,
      label: level.label,
      minServices: level.min_services,
      valueType: level.value_type,
      value: level.value,
    });
  }
  if (fromServer.length > 0) return fromServer;

  return [
    {
      id: discount.tier ?? "applied",
      label: discount.label?.trim() || "Aplicado",
      minServices: 0,
      valueType: "cents_per_litre",
      value: discount.applied_cents,
    },
  ];
}

/** "20 cênt./L", "2,00 € por abastecimento" or "10%". */
export function formatTierValue(tier: ProgrammeTier): string {
  switch (tier.valueType) {
    case "cents_per_litre":
      return formatCents(tier.value);
    case "eur_per_fill":
      return `${formatMoney(tier.value)} por abastecimento`;
    case "percent":
      return `${formatQuantity(tier.value)}%`;
  }
}

/**
 * What you would pay per unit at this level, from the station's list price.
 * A per-fill coupon is spread over the reference fill (the chosen litres, or
 * 50 L in euro mode where the fill size follows from the price).
 */
export function tierEffectivePrice(
  basePrice: number | null,
  tier: Pick<ProgrammeTier, "valueType" | "value">,
  referenceLitres: number,
): number | null {
  if (basePrice === null || !Number.isFinite(basePrice) || referenceLitres <= 0) return null;

  let price: number;
  switch (tier.valueType) {
    case "cents_per_litre":
      price = basePrice - tier.value / 100;
      break;
    case "percent":
      price = basePrice * (1 - tier.value / 100);
      break;
    case "eur_per_fill":
      price = basePrice - tier.value / referenceLitres;
      break;
  }

  return Math.max(0, Math.round(price * 1000) / 1000);
}

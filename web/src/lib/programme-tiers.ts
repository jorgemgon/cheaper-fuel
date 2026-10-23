import type { DiscountEntryInfo, DiscountProgrammeInfo } from "@contracts";

import { formatCents, formatMoney, formatQuantity } from "./format";

export type TierValueType = "cents_per_litre" | "eur_per_fill" | "percent";

export interface ProgrammeTier {
  id: string;
  label: string;
  minServices: number;
  valueType: TierValueType;
  /** Best-case discount for this tier, in the programme's own unit. */
  value: number;
}

function aggregate(combine: "sum" | "max", values: number[]): number {
  if (values.length === 0) return 0;
  return combine === "max" ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0);
}

function tierId(entry: DiscountEntryInfo): string {
  return entry.tier?.trim() || entry.tier_label?.trim() || "";
}

function tierLabel(entry: DiscountEntryInfo): string {
  const label = entry.tier_label?.trim();
  if (label) return label;
  return entry.min_services > 0 ? `${entry.min_services}+ serviços` : "Base";
}

/**
 * Every level of one programme, whatever its unit: COMBINA's 1 / 2 / 3+
 * service tiers, Repsol's base / electricity / electricity+gas tiers, or a
 * single flat level such as BP's €-per-fill coupon.
 */
export function buildProgrammeTiers(programme: DiscountProgrammeInfo): ProgrammeTier[] {
  const groups = new Map<
    string,
    {
      id: string;
      label: string;
      minServices: number;
      combine: "sum" | "max";
      valueType: TierValueType;
      values: number[];
    }
  >();

  for (const entry of programme.discounts) {
    if (entry.status !== "active") continue;
    if (entry.value === null || entry.value_type === null) continue;

    const id = tierId(entry);
    const group = groups.get(id) ?? {
      id,
      label: tierLabel(entry),
      minServices: entry.min_services,
      combine: entry.combine,
      valueType: entry.value_type,
      values: [],
    };

    // A tier is normally one unit; mixed units would need a price to compare.
    if (entry.value_type === group.valueType) group.values.push(entry.value);
    group.minServices = Math.max(group.minServices, entry.min_services);
    if (!group.label) group.label = tierLabel(entry);
    groups.set(id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      id: group.id,
      label: group.label,
      minServices: group.minServices,
      valueType: group.valueType,
      value: aggregate(group.combine, group.values),
    }))
    .sort((a, b) => a.minServices - b.minServices || a.label.localeCompare(b.label, "pt"));
}

/** Ladders for every active programme, single-level ones included. */
export function buildTierLadders(
  programmes: readonly DiscountProgrammeInfo[],
): Map<string, ProgrammeTier[]> {
  const ladders = new Map<string, ProgrammeTier[]>();
  for (const programme of programmes) {
    const tiers = buildProgrammeTiers(programme);
    if (tiers.length > 0) ladders.set(programme.program_id, tiers);
  }
  return ladders;
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

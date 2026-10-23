import type { DiscountProgrammeInfo } from "@contracts";

export interface ProgrammeTier {
  id: string;
  label: string;
  minServices: number;
  /** Best-case discount at this tier, in cents per litre. */
  cents: number;
}

function aggregate(combine: "sum" | "max", values: number[]): number {
  if (values.length === 0) return 0;
  return combine === "max" ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0);
}

/**
 * The tier ladder of one programme (e.g. COMBINA: 1 service, 2 services, 3+
 * services), summed per tier the same way the resolver combines components.
 */
export function buildProgrammeTiers(programme: DiscountProgrammeInfo): ProgrammeTier[] {
  const groups = new Map<
    string,
    { id: string; label: string; minServices: number; combine: "sum" | "max"; values: number[] }
  >();

  for (const entry of programme.discounts) {
    if (entry.status !== "active") continue;
    if (entry.value_type !== "cents_per_litre" || entry.value === null) continue;

    const id = entry.tier ?? entry.tier_label ?? "default";
    const group = groups.get(id) ?? {
      id,
      label: entry.tier_label ?? programme.program_title,
      minServices: entry.min_services,
      combine: entry.combine,
      values: [],
    };
    group.values.push(entry.value);
    group.minServices = Math.max(group.minServices, entry.min_services);
    groups.set(id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      id: group.id,
      label: group.label,
      minServices: group.minServices,
      cents: aggregate(group.combine, group.values),
    }))
    .sort((a, b) => a.minServices - b.minServices || a.label.localeCompare(b.label, "pt"));
}

/** Only multi-tier programmes are worth showing; a single tier adds nothing. */
export function buildTierLadders(
  programmes: readonly DiscountProgrammeInfo[],
): Map<string, ProgrammeTier[]> {
  const ladders = new Map<string, ProgrammeTier[]>();
  for (const programme of programmes) {
    const tiers = buildProgrammeTiers(programme);
    if (tiers.length > 1) ladders.set(programme.program_id, tiers);
  }
  return ladders;
}

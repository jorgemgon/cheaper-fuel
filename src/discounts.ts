import {
  DEFAULT_FILL_LITRES,
  discountStatus,
  isQuantified,
  parseDiscountRow,
  type Discount,
  type DiscountConfidence,
  type DiscountStatus,
} from "./discount-schema";
import { clamp, normalizeText, roundTo } from "./domain";
import type { Env } from "./env";

/** The registry is tiny and changes rarely; a short per-isolate memo is plenty. */
export const DISCOUNT_CACHE_TTL_MS = 60_000;
export const SOURCE_STALE_DAYS = 45;

export interface DiscountRegistry {
  ok: true;
  discounts: Discount[];
  updatedAt: string | null;
}

export interface DiscountRegistryFailure {
  ok: false;
  reason: string;
}

export type DiscountLoadResult = DiscountRegistry | DiscountRegistryFailure;

let memo: { at: number; value: DiscountRegistry } | null = null;

export function resetDiscountCache(): void {
  memo = null;
}

/**
 * Read the standardized discount objects from D1. Any failure (missing binding,
 * missing table, transient error) is reported rather than thrown, so price
 * tools degrade instead of breaking.
 */
export async function loadDiscounts(env: Env): Promise<DiscountLoadResult> {
  const db = env.DB;
  if (!db) return { ok: false, reason: "D1 binding DB is not configured" };

  const now = Date.now();
  if (memo && now - memo.at < DISCOUNT_CACHE_TTL_MS) return memo.value;

  try {
    const result = await db.prepare("SELECT * FROM discounts").all<Record<string, unknown>>();
    const discounts: Discount[] = [];
    let skipped = 0;

    for (const row of result.results ?? []) {
      try {
        discounts.push(parseDiscountRow(row));
      } catch {
        skipped += 1;
      }
    }

    const updatedAt = discounts.reduce<string>(
      (latest, discount) => (discount.updatedAt > latest ? discount.updatedAt : latest),
      "",
    );

    const value: DiscountRegistry = { ok: true, discounts, updatedAt: updatedAt || null };
    if (skipped > 0) console.warn(`discounts: skipped ${skipped} invalid row(s)`);

    memo = { at: now, value };
    return value;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export type DiscountMode = "best_case" | "guaranteed";

export interface DiscountProfile {
  cards: string[];
  services: string[];
  fillLitres: number;
  mode: DiscountMode;
}

export interface DiscountProfileInput {
  cards?: string[];
  services?: string[];
  fillLitres?: number;
  mode?: DiscountMode;
}

export function sanitizeProfile(input: DiscountProfileInput = {}): DiscountProfile {
  const unique = (values: string[] | undefined) =>
    [...new Set((values ?? []).map((value) => normalizeText(value)).filter((value) => value.length > 0))];

  return {
    cards: unique(input.cards),
    services: unique(input.services),
    fillLitres: clamp(input.fillLitres ?? DEFAULT_FILL_LITRES, 5, 120),
    mode: input.mode ?? "best_case",
  };
}

export interface DiscountResolution {
  programId: string;
  programTitle: string;
  tierId: string | null;
  tierLabel: string | null;
  guaranteedCents: number;
  maxCents: number;
  appliedCents: number;
  effectivePriceEur: number | null;
  savesEurPerFill: number;
  conditions: string[];
  confidence: DiscountConfidence;
  componentIds: string[];
  status: DiscountStatus;
  stale: boolean;
}

export interface LockedProgramme {
  programId: string;
  programTitle: string;
  missingRequires: string[];
  missingServices: number;
}

export interface DiscountOutcome {
  applied: DiscountResolution | null;
  possible: DiscountResolution[];
  catalogued: DiscountResolution[];
  locked: LockedProgramme[];
}

export interface StationLike {
  brand: string | null;
  name: string;
  price: number | null;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function isStale(discount: Discount, today: string): boolean {
  return daysBetween(discount.source.retrievedAt, today) > SOURCE_STALE_DAYS;
}

/**
 * Coupons are spend-triggered; app/instant benefits are enrolment-gated.
 * That distinction drives which benefits are guaranteed and which only apply in
 * `best_case` mode.
 */
function isSpendTriggered(discount: Discount): boolean {
  return discount.channel === "coupon" || discount.channel === "cashback";
}

/**
 * Requirements prefixed with `spend:` are conditions the user can trigger by
 * shopping ("spend X at the supermarket"). Everything else is something the
 * user must already hold, and is therefore gated on the declared cards.
 */
function possessionRequirements(discount: Discount): string[] {
  return discount.requires.filter((requirement) => !requirement.startsWith("spend:"));
}

function missingRequirements(discount: Discount, profile: DiscountProfile): string[] {
  // `requires` are capability keys: they can be satisfied by a card/app or by a
  // service the caller declares (for example a Repsol electricity contract).
  const held = new Set([...profile.cards, ...profile.services]);
  return possessionRequirements(discount).filter((requirement) => !held.has(normalizeText(requirement)));
}

function matchesStation(discount: Discount, station: StationLike, unit: string | null): boolean {
  if (unit !== "litro") return false;

  const brand = normalizeText(station.brand ?? "");
  const name = normalizeText(station.name);

  const brandHit =
    brand.length > 0 &&
    discount.stationMatch.brands.some((candidate) => normalizeText(candidate) === brand);
  const prefixHit = discount.stationMatch.namePrefixes.some((prefix) => {
    const key = normalizeText(prefix);
    return key.length > 0 && name.startsWith(key);
  });

  return brandHit || prefixHit;
}

function centsPerLitre(discount: Discount, price: number | null, fillLitres: number): number {
  if (!isQuantified(discount) || discount.value === null) return 0;
  switch (discount.valueType) {
    case "cents_per_litre":
      return discount.value;
    case "percent":
      // `value` is a percentage of the pump price; price is EUR/L, so price × % = cents/L.
      return price === null ? 0 : price * discount.value;
    case "eur_per_fill":
      return (discount.value / fillLitres) * 100;
    default:
      return 0;
  }
}

function aggregate(mode: Discount["combine"], values: number[]): number {
  if (values.length === 0) return 0;
  return mode === "max" ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0);
}

function savingForComponent(discount: Discount, cpl: number, fillLitres: number): number {
  const cap = discount.caps.litresPerFill;
  const litres = cap === null ? fillLitres : Math.min(fillLitres, cap);
  return (cpl / 100) * litres;
}

function uniqueConditions(discounts: Discount[]): string[] {
  const conditions = new Set<string>();
  for (const discount of discounts) {
    for (const requirement of discount.requires) conditions.add(requirement);
    if (discount.source.notes) conditions.add(discount.source.notes);
  }
  return [...conditions];
}

function worstConfidence(discounts: Discount[]): DiscountConfidence {
  if (discounts.some((discount) => discount.confidence === "low")) return "low";
  if (discounts.some((discount) => discount.confidence === "medium")) return "medium";
  return "high";
}

function buildResolution(
  components: Discount[],
  tierRows: Discount[],
  station: StationLike,
  profile: DiscountProfile,
  today: string,
): DiscountResolution | null {
  const head = tierRows[0];
  if (components.length === 0 || !head) return null;

  const mode = head.combine;
  const cplByComponent = components.map((discount) =>
    centsPerLitre(discount, station.price, profile.fillLitres),
  );
  const savings = components.map((discount, index) =>
    savingForComponent(discount, cplByComponent[index], profile.fillLitres),
  );

  const appliedCents = aggregate(mode, cplByComponent);
  const maxCents = aggregate(
    mode,
    tierRows
      .filter(isQuantified)
      .map((discount) => centsPerLitre(discount, station.price, profile.fillLitres)),
  );
  const guaranteedCents = aggregate(
    mode,
    tierRows
      .filter((discount) => !isSpendTriggered(discount) && isQuantified(discount))
      .map((discount) => centsPerLitre(discount, station.price, profile.fillLitres)),
  );

  const totalSaving = aggregate(mode, savings);
  const effectivePriceEur =
    station.price === null
      ? null
      : roundTo(Math.max(0, station.price - totalSaving / profile.fillLitres), 4);

  return {
    programId: head.programId,
    programTitle: head.programTitle,
    tierId: head.tierId,
    tierLabel: head.tierLabel,
    guaranteedCents: roundTo(guaranteedCents, 2),
    maxCents: roundTo(maxCents, 2),
    appliedCents: roundTo(appliedCents, 2),
    effectivePriceEur,
    savesEurPerFill: roundTo(totalSaving, 2),
    conditions: uniqueConditions(tierRows),
    confidence: worstConfidence(tierRows),
    componentIds: components.map((discount) => discount.id),
    status: discountStatus(head, today),
    stale: tierRows.some((discount) => isStale(discount, today)),
  };
}

function catalogueResolution(rows: Discount[], today: string): DiscountResolution | null {
  const head = rows[0];
  if (!head) return null;

  return {
    programId: head.programId,
    programTitle: head.programTitle,
    tierId: head.tierId,
    tierLabel: head.tierLabel,
    guaranteedCents: 0,
    maxCents: 0,
    appliedCents: 0,
    effectivePriceEur: null,
    savesEurPerFill: 0,
    conditions: uniqueConditions(rows),
    confidence: worstConfidence(rows),
    componentIds: rows.map((row) => row.id),
    status: discountStatus(head, today),
    stale: rows.some((row) => isStale(row, today)),
  };
}

/** Tiers ordered from the richest to the most basic. */
function tierBuckets(rows: Discount[]): Discount[][] {
  const byTier = new Map<string, Discount[]>();
  for (const row of rows) {
    const key = row.tierId ?? "__default__";
    const bucket = byTier.get(key) ?? [];
    bucket.push(row);
    byTier.set(key, bucket);
  }
  return [...byTier.values()].sort((a, b) => (b[0]?.minServices ?? 0) - (a[0]?.minServices ?? 0));
}

/**
 * Resolve the discounts that apply to one station for one caller profile.
 * Only high-confidence, quantified benefits are ever applied to the price.
 */
export function resolveForStation(
  discounts: readonly Discount[],
  station: StationLike,
  unit: string | null,
  profile: DiscountProfile,
  today: string,
): DiscountOutcome {
  const outcome: DiscountOutcome = { applied: null, possible: [], catalogued: [], locked: [] };
  if (unit !== "litro") return outcome;

  const matching = discounts.filter(
    (discount) => discountStatus(discount, today) === "active" && matchesStation(discount, station, unit),
  );
  if (matching.length === 0) return outcome;

  const byProgram = new Map<string, Discount[]>();
  for (const discount of matching) {
    const bucket = byProgram.get(discount.programId) ?? [];
    bucket.push(discount);
    byProgram.set(discount.programId, bucket);
  }

  const servicesHeld = profile.services.length;

  for (const rows of byProgram.values()) {
    const quantified = rows.filter(isQuantified);

    if (quantified.length === 0) {
      const catalogue = catalogueResolution(rows, today);
      if (catalogue) outcome.catalogued.push(catalogue);
      continue;
    }

    const tiers = tierBuckets(quantified);
    const eligibleTiers = tiers.filter((tier) =>
      tier.every((discount) => discount.minServices <= servicesHeld),
    );

    if (eligibleTiers.length === 0) {
      const required = Math.min(...tiers.map((tier) => tier[0]?.minServices ?? 0));
      outcome.locked.push({
        programId: rows[0].programId,
        programTitle: rows[0].programTitle,
        missingRequires: [],
        missingServices: required,
      });
      continue;
    }

    let resolved: DiscountResolution | null = null;
    let locked: LockedProgramme | null = null;

    for (const tier of eligibleTiers) {
      const components = tier.filter(
        (discount) =>
          missingRequirements(discount, profile).length === 0 &&
          (profile.mode === "best_case" || !isSpendTriggered(discount)),
      );

      if (components.length === 0) {
        const missing = new Set<string>();
        for (const discount of tier) {
          for (const requirement of missingRequirements(discount, profile)) missing.add(requirement);
        }
        if (missing.size > 0 && locked === null) {
          locked = {
            programId: rows[0].programId,
            programTitle: rows[0].programTitle,
            missingRequires: [...missing],
            missingServices: 0,
          };
        }
        continue;
      }

      resolved = buildResolution(components, tier, station, profile, today);
      if (resolved) break;
    }

    if (resolved) {
      if (resolved.confidence !== "high") {
        outcome.possible.push(resolved);
      } else if (!outcome.applied || resolved.savesEurPerFill > outcome.applied.savesEurPerFill) {
        if (outcome.applied) outcome.possible.push(outcome.applied);
        outcome.applied = resolved;
      } else {
        outcome.possible.push(resolved);
      }
    } else if (locked) {
      outcome.locked.push(locked);
    }
  }

  outcome.possible.sort((a, b) => b.appliedCents - a.appliedCents);
  return outcome;
}

export interface ProgrammeGroup {
  programId: string;
  programTitle: string;
  supplier: string;
  partners: string[];
  kind: Discount["kind"];
  confidence: DiscountConfidence;
  status: DiscountStatus;
  stale: boolean;
  quantified: boolean;
  discounts: Array<Discount & { status: DiscountStatus; stale: boolean }>;
}

/** Group the standardized objects for `list_discount_programs`. */
export function groupProgrammes(discounts: readonly Discount[], today: string): ProgrammeGroup[] {
  const byProgram = new Map<string, Discount[]>();
  for (const discount of discounts) {
    const bucket = byProgram.get(discount.programId) ?? [];
    bucket.push(discount);
    byProgram.set(discount.programId, bucket);
  }

  return [...byProgram.values()]
    .map((rows) => {
      const head = rows[0];
      const status = discountStatus(head, today);
      const group: ProgrammeGroup = {
        programId: head.programId,
        programTitle: head.programTitle,
        supplier: head.supplier,
        partners: [...new Set(rows.flatMap((row) => row.partners))],
        kind: head.kind,
        confidence: worstConfidence(rows),
        status,
        stale: rows.some((row) => isStale(row, today)),
        quantified: rows.some(isQuantified),
        discounts: rows.map((row) => ({ ...row, status, stale: isStale(row, today) })),
      };
      return group;
    })
    .sort(
      (a, b) => a.supplier.localeCompare(b.supplier) || a.programTitle.localeCompare(b.programTitle),
    );
}

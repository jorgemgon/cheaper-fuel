/**
 * The standardized discount object.
 *
 * One object = one atomic, applicable benefit. A composite programme (for
 * example Galp COMBINA, which pays an app discount plus a supermarket coupon)
 * is represented as several rows sharing `programId` and `tierId`, combined at
 * resolution time according to `combine`.
 *
 * There is no `status` field: activeness is always derived from
 * `validFrom` / `validUntil` via {@link discountStatus}.
 */
import { z } from "zod";

import { lisbonToday } from "./domain";

export const DISCOUNT_SCHEMA_VERSION = 1;
export const DEFAULT_FILL_LITRES = 50;

export const discountKindSchema = z.enum(["loyalty_tier", "card_partner", "campaign", "app"]);
export const discountChannelSchema = z.enum(["app", "coupon", "instant", "cashback"]);
export const discountValueTypeSchema = z.enum(["cents_per_litre", "percent", "eur_per_fill"]);
export const discountConfidenceSchema = z.enum(["high", "medium", "low"]);
export const combineModeSchema = z.enum(["sum", "max"]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

export const discountSourceSchema = z.object({
  url: z.string().url(),
  retrievedAt: isoDateSchema,
  contentHash: z.string().nullable().default(null),
  fetchMode: z.enum(["auto", "manual"]).default("auto"),
  notes: z.string().nullable().default(null),
});

export const discountCapsSchema = z.object({
  litresPerFill: z.number().positive().nullable().default(null),
  litresPerYear: z.number().positive().nullable().default(null),
});

export const discountStationMatchSchema = z
  .object({
    brands: z.array(z.string()).default([]),
    namePrefixes: z.array(z.string()).default([]),
  })
  .refine((value) => value.brands.length + value.namePrefixes.length > 0, {
    message: "stationMatch needs at least one brand or name prefix",
  });

export const discountSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase slugs"),
    schemaVersion: z.literal(DISCOUNT_SCHEMA_VERSION).default(DISCOUNT_SCHEMA_VERSION),
    programId: z.string().min(1),
    programTitle: z.string().min(1),
    tierId: z.string().nullable().default(null),
    tierLabel: z.string().nullable().default(null),
    tierRank: z.number().int().min(0).default(0),
    kind: discountKindSchema,
    supplier: z.string().min(1),
    partners: z.array(z.string()).default([]),
    stationMatch: discountStationMatchSchema,
    requires: z.array(z.string()).default([]),
    minServices: z.number().int().min(0).default(0),
    channel: discountChannelSchema,
    valueType: discountValueTypeSchema.nullable().default(null),
    value: z.number().positive().nullable().default(null),
    combine: combineModeSchema.default("sum"),
    caps: discountCapsSchema.default({ litresPerFill: null, litresPerYear: null }),
    validFrom: isoDateSchema.nullable().default(null),
    validUntil: isoDateSchema.nullable().default(null),
    confidence: discountConfidenceSchema,
    source: discountSourceSchema,
    updatedAt: isoDateSchema,
  })
  .refine((value) => (value.valueType === null) === (value.value === null), {
    message: "valueType and value must both be set, or both be null",
    path: ["value"],
  })
  .refine((value) => !value.validFrom || !value.validUntil || value.validFrom <= value.validUntil, {
    message: "validFrom must be on or before validUntil",
    path: ["validUntil"],
  });

export type Discount = z.infer<typeof discountSchema>;
export type DiscountKind = z.infer<typeof discountKindSchema>;
export type DiscountChannel = z.infer<typeof discountChannelSchema>;
export type DiscountValueType = z.infer<typeof discountValueTypeSchema>;
export type DiscountConfidence = z.infer<typeof discountConfidenceSchema>;
export type CombineMode = z.infer<typeof combineModeSchema>;

export type DiscountStatus = "scheduled" | "active" | "expired";

/**
 * Activeness is inferred, never stored. Dates are compared as ISO strings
 * against today in Europe/Lisbon, so a date-only validity window is inclusive
 * of both endpoints.
 */
export function discountStatus(
  discount: Pick<Discount, "validFrom" | "validUntil">,
  today: string = lisbonToday(),
): DiscountStatus {
  if (discount.validFrom && today < discount.validFrom) return "scheduled";
  if (discount.validUntil && today > discount.validUntil) return "expired";
  return "active";
}

/** A programme can be catalogued before its mechanic is quantified. */
export function isQuantified(discount: Pick<Discount, "valueType" | "value">): boolean {
  return discount.valueType !== null && discount.value !== null;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

/** Map a D1 row onto the standardized object, validating it on the way in. */
export function parseDiscountRow(row: Record<string, unknown>): Discount {
  return discountSchema.parse({
    id: row.id,
    schemaVersion: Number(row.schema_version ?? DISCOUNT_SCHEMA_VERSION),
    programId: row.program_id,
    programTitle: row.program_title,
    tierId: nullableString(row.tier_id),
    tierLabel: nullableString(row.tier_label),
    tierRank: Number(row.tier_rank ?? 0),
    kind: row.kind,
    supplier: row.supplier,
    partners: parseJsonArray(row.partners_json),
    stationMatch: {
      brands: parseJsonArray(row.brands_json),
      namePrefixes: parseJsonArray(row.name_prefixes_json),
    },
    requires: parseJsonArray(row.requires_json),
    minServices: Number(row.min_services ?? 0),
    channel: row.channel,
    valueType: nullableString(row.value_type),
    value: nullableNumber(row.value),
    combine: row.combine ?? "sum",
    caps: {
      litresPerFill: nullableNumber(row.cap_litres_per_fill),
      litresPerYear: nullableNumber(row.cap_litres_per_year),
    },
    validFrom: nullableString(row.valid_from),
    validUntil: nullableString(row.valid_until),
    confidence: row.confidence,
    source: {
      url: row.source_url,
      retrievedAt: row.source_retrieved_at,
      contentHash: nullableString(row.source_hash),
      fetchMode: row.source_fetch_mode ?? "auto",
      notes: nullableString(row.notes),
    },
    updatedAt: row.updated_at,
  });
}

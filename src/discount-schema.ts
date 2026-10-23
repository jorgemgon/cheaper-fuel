/**
 * The standardized discount object.
 *
 * One object = one atomic, applicable benefit. A composite programme (for
 * example Galp COMBINA, which pays an app discount plus a supermarket coupon)
 * is represented as several rows sharing `programId` and `tierId`, combined at
 * resolution time according to `combine`.
 *
 * There is no `status` field: activeness is always derived from
 * `validFrom` / `validUntil` via {@link discountStatus}. Some benefits also run
 * only on particular days; that is expressed by {@link scheduleSchema} and
 * evaluated by {@link scheduleMatches}.
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

const weekdaySchema = z.number().int().min(1).max(7); // 1 = Monday … 7 = Sunday

/**
 * When a benefit is available.
 *  - always               — every day
 *  - weekdays             — only on listed ISO weekdays (1 = Monday … 7 = Sunday)
 *  - day_of_month         — only on listed days of the month
 *  - nth_weekday_of_month — only on the Nth given weekday (e.g. first Wednesday)
 */
export const scheduleKindSchema = z.enum([
  "always",
  "weekdays",
  "day_of_month",
  "nth_weekday_of_month",
]);

export const discountScheduleSchema = z
  .object({
    kind: scheduleKindSchema.default("always"),
    weekdays: z.array(weekdaySchema).default([]),
    daysOfMonth: z.array(z.number().int().min(1).max(31)).default([]),
    nth: z.number().int().min(1).max(5).nullable().default(null),
    weekday: weekdaySchema.nullable().default(null),
  })
  .refine((schedule) => schedule.kind !== "weekdays" || schedule.weekdays.length > 0, {
    message: "a weekdays schedule needs at least one weekday",
    path: ["weekdays"],
  })
  .refine((schedule) => schedule.kind !== "day_of_month" || schedule.daysOfMonth.length > 0, {
    message: "a day_of_month schedule needs at least one day",
    path: ["daysOfMonth"],
  })
  .refine(
    (schedule) =>
      schedule.kind !== "nth_weekday_of_month" || (schedule.nth !== null && schedule.weekday !== null),
    { message: "an nth_weekday_of_month schedule needs both nth and weekday", path: ["nth"] },
  );

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
    description: z.object({
      en: z.string().min(10, "every discount needs an English description"),
      pt: z.string().min(10, "every discount needs a Portuguese description"),
    }),
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
    schedule: discountScheduleSchema.default({
      kind: "always",
      weekdays: [],
      daysOfMonth: [],
      nth: null,
      weekday: null,
    }),
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
export type DiscountSchedule = z.infer<typeof discountScheduleSchema>;

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

function weekdayOf(isoDate: string): number | null {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay();
  return day === 0 ? 7 : day; // ISO: Monday = 1 … Sunday = 7
}

/** Whether the day-of-week / day-of-month rule allows the benefit today. */
export function scheduleMatches(
  schedule: DiscountSchedule,
  isoDate: string = lisbonToday(),
): boolean {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;

  switch (schedule.kind) {
    case "weekdays":
      return schedule.weekdays.includes(weekdayOf(isoDate) ?? 0);
    case "day_of_month":
      return schedule.daysOfMonth.includes(date.getUTCDate());
    case "nth_weekday_of_month":
      return (
        schedule.weekday !== null &&
        schedule.nth !== null &&
        weekdayOf(isoDate) === schedule.weekday &&
        Math.ceil(date.getUTCDate() / 7) === schedule.nth
      );
    case "always":
    default:
      return true;
  }
}

/** First date on or after `from` on which the schedule allows the benefit. */
export function nextScheduleDate(
  schedule: DiscountSchedule,
  from: string = lisbonToday(),
): string | null {
  if (schedule.kind === "always") return from;

  const start = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;

  for (let offset = 0; offset <= 62; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    if (scheduleMatches(schedule, candidate)) return candidate;
  }
  return null;
}

/** Human-readable summary of a schedule, for tool output and logs. */
export function describeSchedule(schedule: DiscountSchedule): string {
  const names = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  switch (schedule.kind) {
    case "weekdays":
      return schedule.weekdays.map((day) => names[day] ?? String(day)).join(", ");
    case "day_of_month":
      return `day ${schedule.daysOfMonth.join(", ")} of each month`;
    case "nth_weekday_of_month": {
      const ordinal = ["", "first", "second", "third", "fourth", "fifth"][schedule.nth ?? 0] ?? String(schedule.nth);
      return `${ordinal} ${names[schedule.weekday ?? 0] ?? schedule.weekday} of each month`;
    }
    case "always":
    default:
      return "every day";
  }
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

function parseJsonNumbers(value: unknown): number[] {
  return parseJsonArray(value)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
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
    description: {
      en: String(row.description_en ?? ""),
      pt: String(row.description_pt ?? ""),
    },
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
    schedule: {
      kind: nullableString(row.schedule_kind) ?? "always",
      weekdays: parseJsonNumbers(row.schedule_weekdays_json),
      daysOfMonth: parseJsonNumbers(row.schedule_days_of_month_json),
      nth: nullableNumber(row.schedule_nth),
      weekday: nullableNumber(row.schedule_weekday),
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

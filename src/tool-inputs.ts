/**
 * The tool input schemas. They live here so the MCP tools and the REST API
 * validate identically — an invalid query string and an invalid tool argument
 * produce the same error code and message.
 */
import { z } from "zod";

export const findStationsInput = z.object({
  location: z
    .string()
    .min(1)
    .optional()
    .describe('Where to search: city/concelho ("Leiria"), locality, postal code ("2400-193" or "2400"), or "lat,lon".'),
  latitude: z.number().min(-90).max(90).optional().describe("Latitude, when the client already knows the position."),
  longitude: z.number().min(-180).max(180).optional().describe("Longitude, paired with latitude."),
  municipality: z.string().optional().describe('Restrict to one concelho, e.g. "Leiria". Region mode.'),
  district: z.string().optional().describe('Restrict to one district, e.g. "Lisboa". Region mode.'),
  fuels: z
    .array(z.string())
    .min(1)
    .max(5)
    .optional()
    .describe('Fuel names or ids, e.g. ["diesel"], ["gasolina 95", "98"]. Defaults to diesel + petrol 95.'),
  brand: z.string().optional().describe('Brand name fragment, e.g. "galp", "bp", "pingo doce".'),
  station_type: z
    .enum(["autoestrada", "supermercado", "outro"])
    .optional()
    .describe("highway, supermarket/retail park, or other."),
  radius_km: z.number().min(1).max(60).optional().describe("Initial search radius. Default 15."),
  max_radius_km: z.number().min(1).max(80).optional().describe("Upper bound for automatic widening. Default 40."),
  limit: z.number().int().min(1).max(25).optional().describe("Results per fuel. Default 5."),
  min_price: z.number().min(0).optional().describe("Only stations at or above this price (EUR)."),
  max_price: z.number().min(0).optional().describe("Only stations at or below this price (EUR)."),
  updated_within_hours: z
    .number()
    .min(1)
    .max(8760)
    .optional()
    .describe("Only prices updated within this many hours, e.g. 24."),
  sort: z
    .enum(["distance", "price", "effective_price"])
    .optional()
    .describe(
      "Rank by distance (proximity searches), price, or effective price after discounts. " +
        "Region rankings default to price.",
    ),
  cards: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      'Cards or apps the user holds, e.g. ["continente_card", "mundo_galp_app", ' +
        '"repsol_partner_card", "poupa_mais_card"]. Programmes whose requirements are not all ' +
        "declared are reported as locked_discounts instead of applied.",
    ),
  services: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      'Services or contracts held, e.g. ["galp_energy", "nos_package"], or for Repsol tiers ' +
        '["repsol_electricity", "repsol_gas"]. They satisfy requirements and set the tier.',
    ),
  discount_mode: z
    .enum(["best_case", "guaranteed"])
    .optional()
    .describe("best_case includes spend-triggered coupons; guaranteed counts only permanent app/instant benefits."),
  fill_litres: z
    .number()
    .min(5)
    .max(120)
    .optional()
    .describe("Fill size used for per-fill caps and savings, in litres. Default 50."),
  lang: z
    .enum(["en", "pt"])
    .optional()
    .describe('Language for human-readable discount descriptions: "en" (default) or "pt".'),
});

export const stationDetailsInput = z.object({
  station_id: z.number().int().positive().optional().describe("DGEG station id, as returned by find_stations."),
  station_name: z.string().min(2).optional().describe('Station name or fragment, e.g. "Repsol Leiria".'),
  cards: z
    .array(z.string())
    .max(10)
    .optional()
    .describe('Loyalty cards or apps the user holds, e.g. ["continente_card", "mundo_galp_app"].'),
  services: z
    .array(z.string())
    .max(10)
    .optional()
    .describe('Services held for tiered programmes, e.g. ["galp_energy", "nos_package"].'),
  discount_mode: z.enum(["best_case", "guaranteed"]).optional(),
  fill_litres: z.number().min(5).max(120).optional(),
  lang: z.enum(["en", "pt"]).optional(),
});

export const marketOverviewInput = z.object({
  fuels: z
    .array(z.string())
    .min(1)
    .max(6)
    .optional()
    .describe("Fuel names or ids. Defaults to Gasóleo simples, Gasolina simples 95 and Gasolina 98."),
  district: z.string().optional().describe('District name, e.g. "Porto".'),
  municipality: z.string().optional().describe('Concelho name, e.g. "Porto".'),
});

export const priceHistoryInput = z.object({
  fuels: z
    .array(z.string())
    .min(1)
    .max(5)
    .optional()
    .describe("Fuel names or ids. Defaults to Gasóleo simples and Gasolina simples 95."),
  days: z.number().int().min(7).max(365).optional().describe("Trailing window in days. Default 30."),
  from: z.string().optional().describe("Start date YYYY-MM-DD (overrides days)."),
  to: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
});

export const discountProgramsInput = z.object({
  supplier: z.string().optional().describe('Filter by supplier, e.g. "galp".'),
  partner: z.string().optional().describe('Filter by retail partner, e.g. "continente".'),
  kind: z.enum(["loyalty_tier", "card_partner", "campaign", "app"]).optional(),
  status: z
    .enum(["active", "scheduled", "expired", "all"])
    .optional()
    .describe("Derived status filter. Default active."),
  quantified_only: z
    .boolean()
    .optional()
    .describe("Only programmes with a numeric value (some deals are catalogued before being quantified)."),
  lang: z
    .enum(["en", "pt"])
    .optional()
    .describe('Language for the programme descriptions: "en" (default) or "pt".'),
});

export const listFuelTypesInput = z.object({
  road_only: z.boolean().optional().describe("Only road fuels (excludes heating oil). Default true."),
});

export const listLocationsInput = z.object({
  query: z.string().optional().describe('Search text, e.g. "Leiria", "Marinha" or a postal code.'),
  district: z.string().optional().describe("Restrict to a district."),
  limit: z.number().int().min(1).max(100).optional().describe("Max entries per kind. Default 20."),
});

export type FindStationsArgs = z.infer<typeof findStationsInput>;
export type StationDetailsArgs = z.infer<typeof stationDetailsInput>;
export type MarketOverviewArgs = z.infer<typeof marketOverviewInput>;
export type PriceHistoryArgs = z.infer<typeof priceHistoryInput>;
export type DiscountProgramsArgs = z.infer<typeof discountProgramsInput>;
export type ListFuelTypesArgs = z.infer<typeof listFuelTypesInput>;
export type ListLocationsArgs = z.infer<typeof listLocationsInput>;

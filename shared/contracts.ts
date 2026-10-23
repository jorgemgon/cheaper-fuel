/**
 * Response contracts shared by the MCP tools, the REST API and the Vue app.
 * Type-only: nothing here is emitted at runtime.
 */

export const CONTRACT_VERSION = 1 as const;

export interface DiscountScheduleInfo {
  kind: "always" | "weekdays" | "day_of_month" | "nth_weekday_of_month";
  weekdays: number[];
  daysOfMonth: number[];
  nth: number | null;
  weekday: number | null;
}

export interface DiscountLevelInfo {
  /** Programme tier id, e.g. "combina-3", or null for a flat programme. */
  tier: string | null;
  label: string;
  min_services: number;
  value_type: "cents_per_litre" | "percent" | "eur_per_fill" | null;
  /** Best-case tier value in its own unit (the schedule is not applied). */
  value: number;
  /** Same tier value normalised to cents per litre. */
  cents_per_litre: number;
  effective_price_eur: number | null;
  effective_price_display: string | null;
}

export interface DiscountInfo {
  program_id: string;
  program_title: string;
  description: string;
  tier: string | null;
  label: string | null;
  guaranteed_cents: number;
  max_cents: number;
  applied_cents: number;
  effective_price_eur: number | null;
  effective_price_display: string | null;
  saves_eur_per_fill: number;
  conditions: string[];
  confidence: "high" | "medium" | "low";
  schedule: DiscountScheduleInfo;
  schedule_label: string;
  applies_today: boolean;
  stale: boolean;
  /** Every level of the programme, with the price each level would give. */
  levels?: DiscountLevelInfo[];
}

export interface ScheduledDiscountInfo {
  program_id: string;
  program_title: string;
  description: string;
  schedule: DiscountScheduleInfo;
  schedule_label: string;
  next_date: string | null;
  confidence: "high" | "medium" | "low";
  applies_today: false;
}

export interface LockedDiscountInfo {
  programId: string;
  programTitle: string;
  missingRequires: string[];
  missingServices: number;
}

export interface StationAddress {
  street: string | null;
  locality: string | null;
  postal_code: string | null;
  municipality: string;
  district: string;
}

export interface StationInfo {
  id: number;
  name: string;
  brand: string | null;
  price_eur: number | null;
  price_display: string | null;
  unit: string | null;
  distance_km?: number;
  address: StationAddress;
  coordinates: { latitude: number; longitude: number };
  station_type: string | null;
  last_updated: string;
  maps_url: string;
  discount?: DiscountInfo;
  possible_discounts?: DiscountInfo[];
  scheduled_discounts?: ScheduledDiscountInfo[];
  catalogued_discounts?: DiscountInfo[];
  locked_discounts?: LockedDiscountInfo[];
}

export interface FuelStationList {
  fuel: string;
  unit: string | null;
  stations_found: number;
  stations: StationInfo[];
}

export interface MunicipalityCoverageInfo {
  municipality: string;
  district: string;
  station_count: number;
  min_distance_km: number | null;
}

export interface FindStationsResult {
  source: string;
  data_fetched_at: string;
  registry_updated_at?: string | null;
  discounts_unavailable?: string;
  query: Record<string, unknown>;
  result: {
    mode: "proximity" | "region";
    effective_radius_km?: number;
    fuels: FuelStationList[];
    municipalities_covered: MunicipalityCoverageInfo[];
    stations_in_radius?: number;
    stations_matched?: number;
    note?: string;
  };
}

export interface StationFuelDetail {
  name: string;
  price: number | null;
  unit: string | null;
  updated: string | null;
  price_display: string | null;
  discount?: DiscountInfo;
  possible_discounts?: DiscountInfo[];
  scheduled_discounts?: ScheduledDiscountInfo[];
  catalogued_discounts?: DiscountInfo[];
  locked_discounts?: LockedDiscountInfo[];
}

export interface StationDetail {
  id: number;
  name: string;
  brand: string | null;
  stationType: string | null;
  usage: string | null;
  observations: string | null;
  address: {
    street: string | null;
    locality: string | null;
    postalCode: string | null;
    municipality: string | null;
    district: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  hours: Record<string, string | null> | null;
  services: string[];
  paymentMethods: string[];
  fuels: StationFuelDetail[];
  maps_url?: string | null;
}

export interface StationCandidate {
  station_id: number;
  name: string;
  brand: string | null;
  municipality: string;
  district: string;
}

export interface StationDetailsResult {
  source: string;
  data_fetched_at: string;
  registry_updated_at?: string | null;
  discounts_unavailable?: string;
  query: Record<string, unknown>;
  result: {
    station?: StationDetail;
    ambiguous?: boolean;
    candidates?: StationCandidate[];
    hint?: string;
  };
}

export interface ObservedDiscountInfo {
  date: string;
  avg_discount_eur: number;
  avg_discount_percent: number | null;
  stations: number;
}

export interface MarketFuelStats {
  fuel: string;
  unit: string | null;
  stations: number;
  price_min: number | null;
  price_avg: number | null;
  price_median: number | null;
  price_max: number | null;
  price_spread: number | null;
  observed_discount_national: ObservedDiscountInfo | null;
  cheapest: StationInfo[];
}

export interface MarketOverviewResult {
  source: string;
  data_fetched_at: string;
  query: Record<string, unknown>;
  result: {
    scope: string;
    fuels: MarketFuelStats[];
    note: string;
  };
}

export interface HistoryPoint {
  date: string;
  avg: number | null;
  avg_without_discount: number | null;
  avg_discount_eur: number | null;
  avg_discount_percent: number | null;
  min: number | null;
  max: number | null;
  stations: number;
}

export interface HistoryDiscountSummary {
  avg_discount_eur: number;
  max_discount_eur: number;
  days_with_discount: number;
  discount_share_percent: number | null;
}

export interface HistoryFuel {
  fuel: string;
  unit: string | null;
  days: number;
  first_date: string | null;
  last_date: string | null;
  first_avg: number | null;
  last_avg: number | null;
  change_eur: number | null;
  change_percent: number | null;
  period_min_avg: number | null;
  period_max_avg: number | null;
  period_avg: number | null;
  discount_summary: HistoryDiscountSummary | null;
  points: HistoryPoint[];
}

export interface PriceHistoryResult {
  source: string;
  data_fetched_at: string;
  query: Record<string, unknown>;
  result: {
    scope: string;
    fuels: HistoryFuel[];
    note: string;
  };
}

export interface DiscountSourceInfo {
  url: string;
  retrievedAt: string;
  contentHash: string | null;
  fetchMode: "auto" | "manual";
  notes: string | null;
}

export interface DiscountEntryInfo {
  id: string;
  description: string;
  tier: string | null;
  tier_label: string | null;
  min_services: number;
  channel: "app" | "coupon" | "instant" | "cashback";
  value_type: "cents_per_litre" | "percent" | "eur_per_fill" | null;
  value: number | null;
  combine: "sum" | "max";
  caps: { litresPerFill: number | null; litresPerYear: number | null };
  requires: string[];
  schedule: DiscountScheduleInfo;
  valid_from: string | null;
  valid_until: string | null;
  status: "scheduled" | "active" | "expired";
  stale: boolean;
  source: DiscountSourceInfo;
}

export interface DiscountProgrammeInfo {
  program_id: string;
  program_title: string;
  supplier: string;
  partners: string[];
  kind: "loyalty_tier" | "card_partner" | "campaign" | "app";
  confidence: "high" | "medium" | "low";
  status: "scheduled" | "active" | "expired";
  quantified: boolean;
  stale: boolean;
  discounts: DiscountEntryInfo[];
}

export interface DiscountsResult {
  source: string;
  registry_updated_at: string | null;
  query: Record<string, unknown>;
  result: {
    status_note: string;
    programs: DiscountProgrammeInfo[];
  };
}

export interface FuelTypeInfo {
  id: number;
  name: string;
  unit: string;
  road_fuel: boolean;
}

export interface FuelTypesResult {
  source: string;
  result: {
    fuels: FuelTypeInfo[];
    note: string;
  };
}

export interface LocationsResult {
  source: string;
  data_fetched_at: string;
  result: {
    municipalities: Array<{ name: string; district: string }>;
    localities: Array<{ name: string; municipality: string; district: string }>;
    postal_codes: Array<{ postal_code: string; municipality: string }>;
    note: string;
  };
}

export interface MetaResult {
  source: string;
  version: string;
  data_fetched_at: string | null;
  registry_updated_at: string | null;
  fuels: FuelTypeInfo[];
  defaults: { fuels: string[] };
  notes: {
    coverage: string;
    cache_ttl_seconds: number;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    hint?: string;
    [key: string]: unknown;
  };
}

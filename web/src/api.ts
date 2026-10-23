import type {
  DiscountsResult,
  FindStationsResult,
  LocationsResult,
  MarketOverviewResult,
  MetaResult,
  PriceHistoryResult,
  StationDetailsResult,
} from "@contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;

export function buildUrl(path: string, params: Record<string, QueryValue> = {}): string {
  const base =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost";
  const url = new URL(path, base);

  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === "") continue;
    if (Array.isArray(raw)) {
      const values = raw.map((value) => String(value)).filter((value) => value.length > 0);
      if (values.length > 0) url.searchParams.set(key, values.join(","));
    } else {
      url.searchParams.set(key, String(raw));
    }
  }

  return url.toString();
}

async function request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const response = await fetch(buildUrl(path, params), { headers: { accept: "application/json" } });

  if (!response.ok) {
    let payload: { error?: { code?: string; message?: string } } | null = null;
    try {
      payload = (await response.json()) as { error?: { code?: string; message?: string } };
    } catch {
      payload = null;
    }
    const code = payload?.error?.code ?? "http_error";
    const message = payload?.error?.message ?? `O pedido falhou (HTTP ${response.status}).`;
    throw new ApiError(response.status, code, message, payload?.error);
  }

  return (await response.json()) as T;
}

export interface StationQuery {
  location?: string;
  latitude?: number;
  longitude?: number;
  municipality?: string;
  district?: string;
  fuels?: string[];
  brand?: string;
  station_type?: string;
  radius_km?: number;
  max_radius_km?: number;
  limit?: number;
  min_price?: number;
  max_price?: number;
  updated_within_hours?: number;
  sort?: "distance" | "price" | "effective_price";
  sort_order?: "asc" | "desc";
  cards?: string[];
  services?: string[];
  discount_mode?: "best_case" | "guaranteed";
  fill_litres?: number;
}

export interface DiscountProfileQuery {
  cards?: string[];
  services?: string[];
  discount_mode?: "best_case" | "guaranteed";
  fill_litres?: number;
}

export const api = {
  meta(): Promise<MetaResult> {
    return request<MetaResult>("/api/meta");
  },

  stations(query: StationQuery): Promise<FindStationsResult> {
    // The dashboard UI is pt-PT, so ask for Portuguese discount descriptions.
    return request<FindStationsResult>("/api/stations", { ...query, lang: "pt" });
  },

  station(stationId: number, profile: DiscountProfileQuery = {}): Promise<StationDetailsResult> {
    return request<StationDetailsResult>(`/api/stations/${stationId}`, { ...profile, lang: "pt" });
  },

  market(params: { fuels?: string[]; district?: string; municipality?: string }): Promise<MarketOverviewResult> {
    return request<MarketOverviewResult>("/api/market", { ...params });
  },

  history(params: { fuels?: string[]; days?: number; from?: string; to?: string }): Promise<PriceHistoryResult> {
    return request<PriceHistoryResult>("/api/history", { ...params });
  },

  discounts(
    params: {
      supplier?: string;
      partner?: string;
      kind?: string;
      status?: "active" | "scheduled" | "expired" | "all";
      quantified_only?: boolean;
    } = {},
  ): Promise<DiscountsResult> {
    return request<DiscountsResult>("/api/discounts", { ...params, lang: "pt" });
  },

  locations(params: { query?: string; district?: string; limit?: number }): Promise<LocationsResult> {
    return request<LocationsResult>("/api/locations", { ...params });
  },
};

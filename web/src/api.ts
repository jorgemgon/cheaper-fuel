import type {
  DiscountsResult,
  FindStationsResult,
  MarketOverviewResult,
  MetaResult,
  PriceHistoryResult,
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

/**
 * pt-PT copy for the API's machine-readable error codes. Server messages
 * describe the MCP contract in English, but the dashboard speaks Portuguese,
 * so known codes are translated here and anything unknown falls back to the
 * server text.
 */
const ERROR_MESSAGES_PT: Record<string, string> = {
  location_not_found:
    "Não encontrámos esse local em Portugal continental. Escreve um concelho (por exemplo «Leiria») ou um código postal.",
  unknown_location:
    "Não encontrámos esse local em Portugal continental. Escreve um concelho (por exemplo «Leiria») ou um código postal.",
  ambiguous_location:
    "Esse local existe em mais do que um concelho. Acrescenta o concelho, por exemplo «Santa Catarina, Caldas da Rainha».",
  unsupported_region:
    "A DGEG só publica preços para Portugal continental: os Açores e a Madeira não estão cobertos.",
  unknown_fuel: "Combustível desconhecido. Escolhe outro combustível na lista.",
  unknown_brand: "Marca desconhecida. Retira o filtro de marca.",
  unknown_district: "Distrito desconhecido.",
  unknown_municipality: "Concelho desconhecido.",
  validation_error: "Pedido inválido. Confirma o local e os filtros e tenta de novo.",
  upstream_unavailable: "A DGEG não está a responder neste momento. Tenta daqui a pouco.",
  upstream_error: "A DGEG devolveu um erro. Tenta daqui a pouco.",
  timeout: "A DGEG demorou demasiado a responder. Tenta daqui a pouco.",
  discounts_unavailable:
    "O registo de descontos está indisponível — os preços base continuam corretos.",
  station_not_found: "Posto não encontrado.",
  internal_error: "Erro inesperado do nosso lado. Tenta daqui a pouco.",
};

/** Portuguese copy for a known error code, or null when the code is unknown. */
export function localizedApiMessage(code: string): string | null {
  return ERROR_MESSAGES_PT[code] ?? null;
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
    const message =
      ERROR_MESSAGES_PT[code] ??
      payload?.error?.message ??
      `O pedido falhou (HTTP ${response.status}).`;
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
  limit?: number | "all";
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

export const api = {
  meta(): Promise<MetaResult> {
    return request<MetaResult>("/api/meta");
  },

  stations(query: StationQuery): Promise<FindStationsResult> {
    // The dashboard UI is pt-PT, so ask for Portuguese discount descriptions.
    return request<FindStationsResult>("/api/stations", { ...query, lang: "pt" });
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
};

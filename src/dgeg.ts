import {
  DEFAULT_CACHE_TTL_SECONDS,
  DEFAULT_DGEG_BASE_URL,
  DEFAULT_USER_AGENT,
  type Env,
} from "./env";
import { parsePrice, parseUnit } from "./domain";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CacheStore {
  get(key: string): Promise<Response | undefined>;
  put(key: string, value: Response): Promise<void>;
}

export class AppError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.hint = hint;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, hint?: string) {
    super("validation_error", message, hint);
    this.name = "ValidationError";
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, hint?: string) {
    super("upstream_error", message, hint);
    this.name = "UpstreamError";
  }
}

export class TimeoutError extends AppError {
  constructor(message: string, hint?: string) {
    super("timeout", message, hint);
    this.name = "TimeoutError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, hint?: string) {
    super("not_found", message, hint);
    this.name = "NotFoundError";
  }
}

class RetryableError extends Error {}

const REQUEST_TIMEOUT_MS = 15_000;
const SNAPSHOT_CACHE_PREFIX = "https://cache.cheaper-fuel.internal";

export function snapshotCacheKey(name: string): string {
  return `${SNAPSHOT_CACHE_PREFIX}/${name}`;
}

/** Cache API backed store used in production. */
export const edgeCache: CacheStore = {
  async get(key) {
    return caches.default.match(new Request(key));
  },
  async put(key, value) {
    await caches.default.put(new Request(key), value);
  },
};

/** Deterministic in-memory store for tests and local tooling. */
export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, { body: string; expiresAt: number }>();

  async get(key: string): Promise<Response | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return new Response(entry.body, { headers: { "content-type": "application/json" } });
  }

  async put(key: string, value: Response): Promise<void> {
    const body = await value.text();
    const ttl = Number(/max-age=(\d+)/.exec(value.headers.get("cache-control") ?? "")?.[1] ?? "0");
    this.entries.set(key, { body, expiresAt: Date.now() + ttl * 1000 });
  }
}

export interface DgegContext {
  baseUrl: string;
  userAgent: string;
  ttl: number;
  cache: CacheStore;
  fetchImpl: FetchLike;
}

export function createDgegContext(env: Env, overrides: Partial<DgegContext> = {}): DgegContext {
  const parsedTtl = Number(env.CACHE_TTL_SECONDS ?? DEFAULT_CACHE_TTL_SECONDS);
  return {
    baseUrl: (env.DGEG_BASE_URL ?? DEFAULT_DGEG_BASE_URL).replace(/\/+$/, ""),
    userAgent: env.USER_AGENT ?? DEFAULT_USER_AGENT,
    ttl: Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : DEFAULT_CACHE_TTL_SECONDS,
    cache: overrides.cache ?? edgeCache,
    fetchImpl: overrides.fetchImpl ?? ((input, init) => fetch(input, init)),
  };
}

export type QueryParams = Record<string, string | number | undefined>;

export function buildUrl(baseUrl: string, path: string, params: QueryParams = {}): string {
  const url = new URL(`${baseUrl}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError";
}

/**
 * Fetch and parse a DGEG JSON endpoint. Unknown routes answer HTTP 200 with the
 * public website's HTML, so a content-type/`<` guard is mandatory.
 */
export async function fetchDgegJson(
  ctx: DgegContext,
  path: string,
  params: QueryParams = {},
  retries = 1,
): Promise<unknown> {
  const url = buildUrl(ctx.baseUrl, path, params);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await ctx.fetchImpl(url, {
        headers: { "user-agent": ctx.userAgent, accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 429) {
        throw new UpstreamError(
          "DGEG is rate-limiting this request",
          "Wait a moment and try again; cached data is served when available",
        );
      }
      if (response.status >= 500) {
        throw new RetryableError(`DGEG responded ${response.status}`);
      }
      if (!response.ok) {
        throw new UpstreamError(
          `DGEG responded ${response.status}`,
          "Check the request parameters",
        );
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const text = await response.text();
      if (!contentType.includes("json") || text.trimStart().startsWith("<")) {
        throw new UpstreamError(
          "DGEG returned a non-JSON response",
          "That endpoint or parameter combination is not supported by the DGEG API",
        );
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new UpstreamError("DGEG returned malformed JSON", "Try again in a moment");
      }
    } catch (error) {
      lastError = error;

      if (error instanceof RetryableError) {
        if (attempt < retries) {
          await sleep(300);
          continue;
        }
        throw new UpstreamError(error.message, "Try again in a moment");
      }
      if (error instanceof AppError) throw error;
      if (isAbort(error)) {
        throw new TimeoutError("DGEG did not respond in time", "Try again in a moment");
      }
      if (attempt < retries) {
        await sleep(300);
        continue;
      }
    }
  }

  throw new UpstreamError(
    `Could not reach DGEG: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    "Try again in a moment",
  );
}

interface Payload {
  status?: boolean;
  mensagem?: string;
  resultado?: unknown;
}

export function unwrapResult(raw: unknown, options: { allowEmpty?: boolean } = {}): unknown[] {
  const payload = (raw ?? {}) as Payload;
  const rows = Array.isArray(payload.resultado) ? payload.resultado : [];

  if (payload.status === false && rows.length === 0) {
    if (options.allowEmpty) return [];
    throw new UpstreamError(
      `DGEG rejected the request: ${payload.mensagem ?? "unknown error"}`,
      "Check the query parameters",
    );
  }

  return rows;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function cachedJson<T>(
  ctx: DgegContext,
  path: string,
  params: QueryParams,
  transform: (raw: unknown) => T,
): Promise<T> {
  const url = buildUrl(ctx.baseUrl, path, params);
  const cached = await ctx.cache.get(url);
  if (cached) return (await cached.json()) as T;

  const value = transform(await fetchDgegJson(ctx, path, params));
  await ctx.cache.put(
    url,
    new Response(JSON.stringify(value), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${ctx.ttl}`,
      },
    }),
  );
  return value;
}

export interface FuelType {
  id: number;
  name: string;
  unit: string;
  roadFuel: boolean;
}

export interface District {
  id: number;
  name: string;
}

export interface Municipality {
  id: number;
  name: string;
  districtId: number;
  districtName: string;
}

export interface Brand {
  id: number;
  name: string;
}

export interface PostType {
  id: number;
  name: string;
}

export async function getFuelTypes(ctx: DgegContext): Promise<FuelType[]> {
  const fuels = await cachedJson(ctx, "GetTiposCombustiveis", {}, (raw) =>
    unwrapResult(raw).map((row) => {
      const record = asRecord(row);
      return {
        id: asNumber(record.Id) ?? 0,
        name: asString(record.Descritivo) ?? "",
        unit: asString(record.UnidadeMedida) ?? "litro",
        roadFuel: record.fl_rodoviario === true,
      } satisfies FuelType;
    }),
  );
  return fuels.filter((fuel) => fuel.id > 0 && fuel.name.length > 0).sort((a, b) => a.id - b.id);
}

export async function getDistricts(ctx: DgegContext): Promise<District[]> {
  return cachedJson(ctx, "GetDistritos", {}, (raw) =>
    unwrapResult(raw).map((row) => {
      const record = asRecord(row);
      return { id: asNumber(record.Id) ?? 0, name: asString(record.Descritivo) ?? "" };
    }),
  );
}

export async function getMunicipalities(ctx: DgegContext): Promise<Municipality[]> {
  return cachedJson(ctx, "GetMunicipios", {}, (raw) =>
    unwrapResult(raw).map((row) => {
      const record = asRecord(row);
      const district = asRecord(record.Distrito);
      return {
        id: asNumber(record.Id) ?? 0,
        name: asString(record.Descritivo) ?? "",
        districtId: asNumber(record.IdDistrito) ?? 0,
        districtName: asString(district.Descritivo) ?? "",
      };
    }),
  );
}

export async function getBrands(ctx: DgegContext): Promise<Brand[]> {
  return cachedJson(ctx, "GetMarcas", {}, (raw) =>
    unwrapResult(raw).map((row) => {
      const record = asRecord(row);
      return { id: asNumber(record.Id) ?? 0, name: asString(record.Descritivo) ?? "" };
    }),
  );
}

export async function getPostTypes(ctx: DgegContext): Promise<PostType[]> {
  return cachedJson(ctx, "GetTiposPostos", {}, (raw) =>
    unwrapResult(raw).map((row) => {
      const record = asRecord(row);
      return { id: asNumber(record.Id) ?? 0, name: asString(record.Descritivo) ?? "" };
    }),
  );
}

export interface StationFuelPrice {
  name: string;
  price: number | null;
  unit: string | null;
  updated: string | null;
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
  fuels: StationFuelPrice[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asString(asRecord(entry).Descritivo))
    .filter((entry): entry is string => entry !== null);
}

export async function getStationDetail(
  ctx: DgegContext,
  stationId: number,
): Promise<StationDetail | null> {
  return cachedJson(ctx, "GetDadosPosto", { id: stationId }, (raw) => {
    const payload = (raw ?? {}) as Payload;
    if (payload.status === false) return null;
    const record = asRecord(payload.resultado);
    if (Object.keys(record).length === 0) return null;

    const address = asRecord(record.Morada);
    const hours = asRecord(record.HorarioPosto);

    return {
      id: stationId,
      name: asString(record.Nome) ?? "",
      brand: asString(record.Marca),
      stationType: asString(record.TipoPosto),
      usage: asString(record.Utilizacao),
      observations: asString(record.Observacoes),
      address: {
        street: asString(address.Morada),
        locality: asString(address.Localidade),
        postalCode: asString(address.CodPostal),
        municipality: asString(address.Municipio),
        district: asString(address.Distrito),
        latitude: asNumber(address.Latitude),
        longitude: asNumber(address.Longitude),
      },
      hours:
        Object.keys(hours).length === 0
          ? null
          : {
              weekdays: asString(hours.DiasUteis),
              saturday: asString(hours.Sabado),
              sunday: asString(hours.Domingo),
              holiday: asString(hours.Feriado),
            },
      services: stringList(record.Servicos),
      paymentMethods: stringList(record.MeiosPagamento),
      fuels: (Array.isArray(record.Combustiveis) ? record.Combustiveis : []).map((entry) => {
        const fuel = asRecord(entry);
        const rawPrice = asString(fuel.Preco);
        return {
          name: asString(fuel.TipoCombustivel) ?? "",
          price: parsePrice(rawPrice),
          unit: parseUnit(rawPrice),
          updated: asString(fuel.DataAtualizacao ?? null),
        };
      }),
    } satisfies StationDetail;
  });
}

export interface HistoryRow {
  date: string;
  fuel: string;
  unit: string | null;
  stationCount: number;
  avg: number | null;
  avgNoDiscount: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
}

const HISTORY_PAGE_SIZE = 500;
const HISTORY_MAX_PAGES = 5;

export async function getDailyHistory(
  ctx: DgegContext,
  params: { fuelIds: number[]; from: string; to: string },
): Promise<HistoryRow[]> {
  const rows: HistoryRow[] = [];

  for (let page = 1; page <= HISTORY_MAX_PAGES; page += 1) {
    const pageRows = await cachedJson(
      ctx,
      "PMD",
      {
        idsTiposComb: params.fuelIds.join(","),
        dataIni: params.from,
        dataFim: params.to,
        qtdPorPagina: HISTORY_PAGE_SIZE,
        pagina: page,
        orderDesc: 1,
      },
      (raw) =>
        unwrapResult(raw, { allowEmpty: true }).map((row) => {
          const record = asRecord(row);
          return {
            date: asString(record.Data) ?? "",
            fuel: asString(record.TipoCombustivel) ?? "",
            unit: asString(record.UnidadeMedida),
            stationCount: asNumber(record.NumPostos) ?? 0,
            avg: parsePrice(asString(record.PrecoMedio)),
            avgNoDiscount: parsePrice(asString(record.PrecoMedioSDesc)),
            min: parsePrice(asString(record.PrecoMin)),
            max: parsePrice(asString(record.PrecoMax)),
            stdDev: parsePrice(asString(record.DescPadrao)),
          } satisfies HistoryRow;
        }),
    );

    rows.push(...pageRows);
    if (pageRows.length < HISTORY_PAGE_SIZE) break;
  }

  return rows;
}

/** Cache-bypassing liveness probe used by /health. */
export async function pingUpstream(ctx: DgegContext): Promise<boolean> {
  try {
    const response = await ctx.fetchImpl(buildUrl(ctx.baseUrl, "GetDistritos"), {
      headers: { "user-agent": ctx.userAgent, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const text = await response.text();
    return /"status"\s*:\s*true/.test(text);
  } catch {
    return false;
  }
}

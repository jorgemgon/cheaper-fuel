import {
  asNumber,
  asRecord,
  asString,
  fetchDgegJson,
  snapshotCacheKey,
  unwrapResult,
  UpstreamError,
  type DgegContext,
} from "./dgeg";
import { parsePrice } from "./domain";

/**
 * The whole national price table (one row per station × fuel) is small enough
 * to fetch in a few pages, cache for a day and keep in memory per isolate.
 * Nearly every tool is answered from this snapshot.
 */
export interface SnapshotRow {
  id: number;
  name: string;
  brand: string | null;
  fuel: string;
  price: number | null;
  lat: number;
  lon: number;
  postalCode: string | null;
  locality: string | null;
  municipality: string;
  district: string;
  stationType: string | null;
  address: string | null;
  updated: string;
}

export interface Snapshot {
  rows: SnapshotRow[];
  fetchedAt: string;
  count: number;
}

const CACHE_KEY = snapshotCacheKey("snapshot/v1");
const PAGE_SIZE = 5000;
const MAX_PAGES = 5;

let memo: { key: string; expiresAt: number; value: Snapshot } | null = null;
let inflight: { key: string; promise: Promise<Snapshot> } | null = null;

export function resetSnapshotCache(): void {
  memo = null;
  inflight = null;
}

function mapRow(raw: unknown): SnapshotRow | null {
  const record = asRecord(raw);
  const id = asNumber(record.Id);
  const lat = asNumber(record.Latitude);
  const lon = asNumber(record.Longitude);
  const fuel = asString(record.Combustivel);

  if (id === null || lat === null || lon === null || !fuel) return null;
  if (lat === 0 && lon === 0) return null;

  return {
    id,
    name: asString(record.Nome) ?? "",
    brand: asString(record.Marca),
    fuel,
    price: parsePrice(record.Preco),
    lat,
    lon,
    postalCode: asString(record.CodPostal),
    locality: asString(record.Localidade),
    municipality: asString(record.Municipio) ?? "",
    district: asString(record.Distrito) ?? "",
    stationType: asString(record.TipoPosto),
    address: asString(record.Morada),
    updated: asString(record.DataAtualizacao) ?? "",
  };
}

async function fetchSnapshot(ctx: DgegContext): Promise<Snapshot> {
  const cached = await ctx.cache.get(CACHE_KEY);
  if (cached) return (await cached.json()) as Snapshot;

  const rows: SnapshotRow[] = [];
  let seen = 0;
  let total = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageRows = unwrapResult(
      await fetchDgegJson(ctx, "PesquisarPostos", {
        idsTiposComb: "",
        qtdPorPagina: PAGE_SIZE,
        pagina: page,
      }),
      { allowEmpty: true },
    );

    if (pageRows.length === 0) break;
    seen += pageRows.length;

    for (const raw of pageRows) {
      const row = mapRow(raw);
      if (row) rows.push(row);
    }

    if (total === 0) total = asNumber(asRecord(pageRows[0]).Quantidade) ?? 0;
    if (pageRows.length < PAGE_SIZE) break;
    if (total > 0 && seen >= total) break;
  }

  if (rows.length === 0) {
    throw new UpstreamError(
      "DGEG returned no station data",
      "The upstream service may be down; try again later",
    );
  }

  const snapshot: Snapshot = {
    rows,
    fetchedAt: new Date().toISOString(),
    count: rows.length,
  };

  await ctx.cache.put(
    CACHE_KEY,
    new Response(JSON.stringify(snapshot), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${ctx.ttl}`,
      },
    }),
  );

  return snapshot;
}

export async function loadSnapshot(ctx: DgegContext): Promise<Snapshot> {
  const key = `${ctx.baseUrl}|${CACHE_KEY}`;
  const now = Date.now();

  if (memo && memo.key === key && memo.expiresAt > now) return memo.value;
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = fetchSnapshot(ctx).then((snapshot) => {
    memo = { key, expiresAt: Date.now() + ctx.ttl * 1000, value: snapshot };
    return snapshot;
  });

  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight && inflight.promise === promise) inflight = null;
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDgegContext, MemoryCache, UpstreamError, type FetchLike } from "../src/dgeg";
import { loadSnapshot, resetSnapshotCache } from "../src/snapshot";

function makeRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    Id: index,
    Nome: `Station ${index}`,
    TipoPosto: "Outro",
    Municipio: "Leiria",
    Preco: "2,014 €",
    Marca: "GALP",
    Combustivel: "Gasolina simples 95",
    DataAtualizacao: "2026-10-20 08:00",
    Distrito: "Leiria",
    Morada: "Rua A",
    Localidade: "Leiria",
    CodPostal: "2400-193",
    Latitude: 39.74,
    Longitude: -8.81,
    Quantidade: 1,
    ...overrides,
  };
}

function makeCtx(fetchImpl: FetchLike, cache = new MemoryCache()) {
  return createDgegContext(
    { DGEG_BASE_URL: "https://dgeg.test/api", CACHE_TTL_SECONDS: "60" },
    { fetchImpl, cache },
  );
}

beforeEach(() => {
  resetSnapshotCache();
});

describe("loadSnapshot", () => {
  it("loads one page and compacts the rows", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ status: true, resultado: [makeRow(1, { Quantidade: 1 })] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const snapshot = await loadSnapshot(makeCtx(fetchImpl as FetchLike));
    expect(snapshot.count).toBe(1);
    expect(snapshot.rows[0]).toMatchObject({
      id: 1,
      fuel: "Gasolina simples 95",
      municipality: "Leiria",
      postalCode: "2400-193",
    });
    expect(snapshot.rows[0].price).toBeCloseTo(2.014, 4);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pages until a short page arrives", async () => {
    const fullPage = Array.from({ length: 5000 }, (_, index) =>
      makeRow(index + 1, { Quantidade: 5002 }),
    );
    const shortPage = [makeRow(5001, { Quantidade: 5002 }), makeRow(5002, { Quantidade: 5002 })];

    const fetchImpl = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("pagina"));
      const resultado = page === 1 ? fullPage : shortPage;
      return new Response(JSON.stringify({ status: true, resultado }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const snapshot = await loadSnapshot(makeCtx(fetchImpl as FetchLike));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(snapshot.count).toBe(5002);
  });

  it("drops rows without usable coordinates", async () => {
    const resultado = [
      makeRow(1),
      makeRow(2, { Latitude: 0, Longitude: 0 }),
      makeRow(3, { Latitude: undefined }),
    ];

    const fetchImpl = async () =>
      new Response(JSON.stringify({ status: true, resultado }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const snapshot = await loadSnapshot(makeCtx(fetchImpl as FetchLike));
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].id).toBe(1);
  });

  it("fails loudly when DGEG returns nothing", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ status: false, mensagem: "Nenhum posto encontrado.", resultado: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    await expect(loadSnapshot(makeCtx(fetchImpl as FetchLike))).rejects.toBeInstanceOf(UpstreamError);
  });

  it("reuses the cached snapshot across isolates", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: true, resultado: [makeRow(1)] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const cache = new MemoryCache();
    const ctx = makeCtx(fetchImpl as FetchLike, cache);

    await loadSnapshot(ctx);
    resetSnapshotCache();
    const second = await loadSnapshot(ctx);

    expect(second.count).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

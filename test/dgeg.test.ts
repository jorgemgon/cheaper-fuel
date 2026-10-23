import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDgegContext,
  fetchDgegJson,
  getDistricts,
  getFuelTypes,
  MemoryCache,
  unwrapResult,
  UpstreamError,
  type FetchLike,
} from "../src/dgeg";

function jsonResponse(body: unknown, status = 200, contentType = "application/json; charset=utf-8") {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

function makeCtx(fetchImpl: FetchLike, cache = new MemoryCache(), ttl = 60) {
  return createDgegContext(
    { DGEG_BASE_URL: "https://dgeg.test/api", CACHE_TTL_SECONDS: String(ttl) },
    { fetchImpl, cache },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getFuelTypes", () => {
  it("maps the DGEG catalogue", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: true,
        resultado: [
          { Id: 3201, Descritivo: "Gasolina simples 95", UnidadeMedida: "litro", fl_rodoviario: true },
          { Id: 2155, Descritivo: "Gasóleo de aquecimento", UnidadeMedida: "litro", fl_rodoviario: false },
        ],
      }),
    );

    const fuels = await getFuelTypes(makeCtx(fetchImpl as FetchLike));
    expect(fuels).toHaveLength(2);
    expect(fuels.find((fuel) => fuel.id === 3201)).toMatchObject({ unit: "litro", roadFuel: true });
    expect(fuels.find((fuel) => fuel.id === 2155)?.roadFuel).toBe(false);
  });

  it("serves repeat calls from cache", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: true, resultado: [{ Id: 3201, Descritivo: "Gasolina", UnidadeMedida: "litro" }] }),
    );
    const ctx = makeCtx(fetchImpl as FetchLike);

    await getFuelTypes(ctx);
    await getFuelTypes(ctx);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: true, resultado: [{ Id: 3201, Descritivo: "Gasolina", UnidadeMedida: "litro" }] }),
    );
    const ctx = makeCtx(fetchImpl as FetchLike, new MemoryCache(), 60);

    await getFuelTypes(ctx);
    vi.setSystemTime(new Date("2026-10-23T00:02:00Z"));
    await getFuelTypes(ctx);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("getDistricts", () => {
  it("maps id/name pairs", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        status: true,
        resultado: [
          { Id: 10, Descritivo: "Leiria" },
          { Id: 11, Descritivo: "Lisboa" },
        ],
      });

    const districts = await getDistricts(makeCtx(fetchImpl as FetchLike));
    expect(districts).toEqual([
      { id: 10, name: "Leiria" },
      { id: 11, name: "Lisboa" },
    ]);
  });
});

describe("upstream guards", () => {
  it("rejects the website HTML that unknown routes return", async () => {
    const fetchImpl = async () =>
      new Response("<!doctype html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });

    await expect(fetchDgegJson(makeCtx(fetchImpl as FetchLike), "Nope")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("retries once on a 5xx", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "boom" }, 503);
      return jsonResponse({ status: true, resultado: [] });
    };

    const payload = await fetchDgegJson(makeCtx(fetchImpl as FetchLike), "GetDistritos");
    expect(payload).toEqual({ status: true, resultado: [] });
    expect(calls).toBe(2);
  });

  it("does not retry a 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "slow down" }, 429));
    await expect(fetchDgegJson(makeCtx(fetchImpl as FetchLike), "PesquisarPostos")).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces malformed JSON as an upstream error", async () => {
    const fetchImpl = async () =>
      new Response("{not json", { status: 200, headers: { "content-type": "application/json" } });
    await expect(fetchDgegJson(makeCtx(fetchImpl as FetchLike), "GetDistritos")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("unwrapResult", () => {
  it("treats a failed status as an upstream error", () => {
    expect(() => unwrapResult({ status: false, mensagem: "Nenhum posto encontrado.", resultado: null })).toThrow(
      UpstreamError,
    );
  });

  it("allows an empty result set when requested", () => {
    expect(unwrapResult({ status: false, resultado: null }, { allowEmpty: true })).toEqual([]);
  });

  it("returns rows from a successful payload", () => {
    expect(unwrapResult({ status: true, resultado: [{ Id: 1 }] })).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";

import {
  booleanParam,
  handleApi,
  historyQuery,
  listParam,
  numberParam,
  stationsQuery,
} from "../src/api";
import { findStationsInput } from "../src/tool-inputs";
import type { Env } from "../src/env";

const env = {} as Env;

function get(path: string): Request {
  return new Request(`https://cheaper-fuel.test${path}`);
}

describe("query coercion", () => {
  it("accepts comma-separated and repeated list params", () => {
    expect(listParam(new URLSearchParams("cards=a,b"), "cards")).toEqual(["a", "b"]);
    expect(listParam(new URLSearchParams("cards=a&cards=b"), "cards")).toEqual(["a", "b"]);
    expect(listParam(new URLSearchParams("cards=a,b&cards=c"), "cards")).toEqual(["a", "b", "c"]);
    expect(listParam(new URLSearchParams("cards="), "cards")).toBeUndefined();
    expect(listParam(new URLSearchParams(), "cards")).toBeUndefined();
  });

  it("parses numbers and passes NaN through for the schema to reject", () => {
    expect(numberParam(new URLSearchParams("limit=5"), "limit")).toBe(5);
    expect(numberParam(new URLSearchParams("radius_km=12.5"), "radius_km")).toBe(12.5);
    expect(numberParam(new URLSearchParams("limit="), "limit")).toBeUndefined();
    expect(Number.isNaN(numberParam(new URLSearchParams("limit=abc"), "limit"))).toBe(true);
  });

  it("parses booleans", () => {
    expect(booleanParam(new URLSearchParams("quantified_only=true"), "quantified_only")).toBe(true);
    expect(booleanParam(new URLSearchParams("quantified_only=0"), "quantified_only")).toBe(false);
    expect(booleanParam(new URLSearchParams("quantified_only=maybe"), "quantified_only")).toBeUndefined();
  });

  it("builds a station query object", () => {
    const query = stationsQuery(
      new URLSearchParams("location=Leiria&fuels=diesel,95&cards=continente_card&limit=3&sort=effective_price"),
    );
    expect(query.location).toBe("Leiria");
    expect(query.fuels).toEqual(["diesel", "95"]);
    expect(query.cards).toEqual(["continente_card"]);
    expect(query.limit).toBe(3);
    expect(query.sort).toBe("effective_price");
  });

  it("builds a history query object", () => {
    expect(historyQuery(new URLSearchParams("fuels=diesel&days=90"))).toEqual({
      fuels: ["diesel"],
      days: 90,
      from: undefined,
      to: undefined,
    });
  });

  it("accepts limit=all as \u201cevery station in the radius\u201d", () => {
    expect(stationsQuery(new URLSearchParams("location=Leiria&limit=all")).limit).toBe("all");
    expect(stationsQuery(new URLSearchParams("location=Leiria&limit=ALL")).limit).toBe("all");
    expect(stationsQuery(new URLSearchParams("location=Leiria&limit=25")).limit).toBe(25);
    const invalidLimit = stationsQuery(new URLSearchParams("limit=abc")).limit;
    expect(typeof invalidLimit === "number" && Number.isNaN(invalidLimit)).toBe(true);
  });

  it("validates limit=all against the shared station schema", () => {
    expect(findStationsInput.parse({ location: "Leiria", limit: "all" }).limit).toBe("all");
    expect(() => findStationsInput.parse({ location: "Leiria", limit: "bogus" })).toThrow();
    expect(() => findStationsInput.parse({ location: "Leiria", limit: 0 })).toThrow();
  });

  it("accepts every catalogue fuel so an empty filter can request them all", () => {
    const fuels = [
      "GPL Auto",
      "GNC (gás natural comprimido) - €/m3",
      "GNL (gás natural liquefeito) - €/kg",
      "GNC (gás natural comprimido) - €/kg",
      "Gasóleo simples",
      "Gasóleo especial",
      "Biodiesel B15",
      "Gasóleo colorido",
      "Gasolina simples 95",
      "Gasolina especial 95",
      "Gasolina de mistura (motores a 2 tempos)",
      "Gasolina 98",
      "Gasolina especial 98",
    ];

    expect(findStationsInput.parse({ location: "Leiria", fuels }).fuels).toHaveLength(13);
    expect(() =>
      findStationsInput.parse({ location: "Leiria", fuels: Array.from({ length: 21 }, () => "diesel") }),
    ).toThrow();
  });
});

describe("handleApi", () => {
  it("rejects non-GET methods with 405", async () => {
    const response = await handleApi(new Request("https://cheaper-fuel.test/api/stations", { method: "POST" }), env);
    expect(response.status).toBe(405);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("method_not_allowed");
  });

  it("returns 404 for an unknown route", async () => {
    const response = await handleApi(get("/api/nope"), env);
    expect(response.status).toBe(404);
  });

  it("returns 404 for a non-numeric station id", async () => {
    const response = await handleApi(get("/api/stations/abc"), env);
    expect(response.status).toBe(404);
  });

  it("lists the available endpoints at /api", async () => {
    const response = await handleApi(get("/api"), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { endpoints: string[] };
    expect(body.endpoints).toContain("/api/stations");
  });

  it("rejects an invalid limit before touching any data source", async () => {
    const response = await handleApi(get("/api/stations?location=Leiria&limit=abc"), env);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; issues: unknown[] } };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.issues.length).toBeGreaterThan(0);
  });

  it("rejects an invalid sort value", async () => {
    const response = await handleApi(get("/api/stations?location=Leiria&sort=bogus"), env);
    expect(response.status).toBe(400);
  });

  it("rejects an invalid station_type", async () => {
    const response = await handleApi(get("/api/stations?location=Leiria&station_type=castle"), env);
    expect(response.status).toBe(400);
  });

  it("rejects an invalid discount status filter", async () => {
    const response = await handleApi(get("/api/discounts?status=maybe"), env);
    expect(response.status).toBe(400);
  });

  it("rejects an unknown language", async () => {
    const response = await handleApi(get("/api/discounts?lang=xx"), env);
    expect(response.status).toBe(400);
  });

  it("passes the language through the station query", () => {
    const query = stationsQuery(new URLSearchParams("location=Leiria&lang=pt"));
    expect(query.lang).toBe("pt");
  });

  it("rejects an out-of-range history window", async () => {
    const response = await handleApi(get("/api/history?fuels=diesel&days=5000"), env);
    expect(response.status).toBe(400);
  });

  it("marks API responses as cacheable and CORS-open", async () => {
    const response = await handleApi(get("/api"), env);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, buildUrl, localizedApiMessage } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildUrl", () => {
  it("keeps the path and encodes simple params", () => {
    const url = buildUrl("/api/stations", { location: "Leiria", limit: 3 });
    expect(url).toContain("/api/stations");
    expect(url).toContain("location=Leiria");
    expect(url).toContain("limit=3");
  });

  it("joins array params with commas", () => {
    const url = buildUrl("/api/stations", { fuels: ["diesel", "95"], cards: [] });
    expect(url).toContain("fuels=diesel%2C95");
    expect(url).not.toContain("cards=");
  });

  it("keeps the 'all' limit as a readable parameter", () => {
    const url = buildUrl("/api/stations", { location: "Leiria", limit: "all" });
    expect(url).toContain("limit=all");
  });

  it("drops empty values", () => {
    const url = buildUrl("/api/market", { fuels: undefined, district: "", municipality: null });
    expect(url).not.toContain("fuels=");
    expect(url).not.toContain("district=");
    expect(url).not.toContain("municipality=");
  });
});

describe("api client", () => {
  it("returns parsed JSON on success", async () => {
    const payload = { source: "DGEG", result: { programs: [] } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );

    await expect(api.discounts()).resolves.toMatchObject({ source: "DGEG" });
  });

  it("surfaces API errors with code and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "unknown_fuel", message: "Combustível inválido." } }), {
            status: 400,
          }),
      ),
    );

    await expect(api.stations({ fuels: ["nope"] })).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "unknown_fuel",
    });
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 502 })));

    await expect(api.meta()).rejects.toBeInstanceOf(ApiError);
  });

  it("translates known server error codes into pt-PT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "unknown_location",
                message: 'No Portuguese mainland place matched "2430-304".',
              },
            }),
            { status: 400 },
          ),
      ),
    );

    await expect(api.stations({ location: "2430-304" })).rejects.toMatchObject({
      code: "unknown_location",
      message: expect.stringContaining("Portugal continental"),
    });
  });

  it("keeps the server message for codes it does not know", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "teapot", message: "Server says no." } }), {
            status: 418,
          }),
      ),
    );

    await expect(api.meta()).rejects.toMatchObject({
      code: "teapot",
      message: "Server says no.",
    });
  });

  it("exposes the localized copy for a code, and null when unknown", () => {
    expect(localizedApiMessage("unsupported_region")).toMatch(/Açores/);
    expect(localizedApiMessage("teapot")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { sourceHost, sourceLinks } from "./sources";

const entry = (url: string) => ({ source: { url } });

describe("sourceHost", () => {
  it("uses the hostname for a page", () => {
    expect(sourceHost("https://www.galp.com/pt/casa/blog/combina")).toBe("www.galp.com");
  });

  it("labels a regulation PDF", () => {
    expect(sourceHost("https://www.lidl.pt/static/assets/regulamento.pdf")).toBe("regulamento");
  });

  it("falls back to the raw value for junk", () => {
    expect(sourceHost("not a url")).toBe("not a url");
  });
});

describe("sourceLinks", () => {
  it("collapses repeated URLs to a single link", () => {
    const links = sourceLinks([
      entry("https://www.galp.com/pt/a"),
      entry("https://www.galp.com/pt/a"),
      entry("https://www.galp.com/pt/a"),
    ]);
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe("www.galp.com");
  });

  it("keeps one label per host when a programme has a single source", () => {
    const links = sourceLinks([entry("https://www.pingodoce.pt/parcerias/bp/")]);
    expect(links[0]).toEqual({ url: "https://www.pingodoce.pt/parcerias/bp/", label: "www.pingodoce.pt" });
  });

  it("disambiguates distinct pages on the same host", () => {
    const links = sourceLinks([
      entry("https://www.repsol.pt/particulares/beneficios/plano-motor/"),
      entry("https://www.repsol.pt/particulares/beneficios/plano-motor-luz/"),
      entry("https://www.repsol.pt/particulares/beneficios/plano-motor-luz-calor/"),
    ]);

    expect(links).toHaveLength(3);
    const labels = links.map((link) => link.label);
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toBe("www.repsol.pt/plano-motor");
    expect(labels[1]).toBe("www.repsol.pt/plano-motor-luz");
  });

  it("does not append a path when only one page is on the host", () => {
    const links = sourceLinks([
      entry("https://www.repsol.pt/particulares/beneficios/plano-motor/"),
      entry("https://www.pingodoce.pt/parcerias/bp/"),
    ]);
    expect(links.map((link) => link.label).sort()).toEqual([
      "www.pingodoce.pt",
      "www.repsol.pt",
    ]);
  });
});

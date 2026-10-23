export interface SourceLink {
  url: string;
  label: string;
}

/** Human label for one source URL: the host, or "regulamento" for a PDF. */
export function sourceHost(url: string): string {
  if (url.includes(".pdf")) return "regulamento";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * One link per distinct source. When several pages share a host (for example the
 * three Repsol Plano Motor pages) the last path segment is appended, so the
 * labels stay distinct instead of printing the same domain three times.
 */
export function sourceLinks(
  discounts: ReadonlyArray<{ source: { url: string } }>,
): SourceLink[] {
  const urls = [...new Set(discounts.map((entry) => entry.source.url))];

  const perHost = new Map<string, number>();
  for (const url of urls) {
    const host = sourceHost(url);
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
  }

  return urls.map((url) => {
    const host = sourceHost(url);
    if ((perHost.get(host) ?? 0) <= 1 || url.includes(".pdf")) return { url, label: host };

    try {
      const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      const short = segment.length > 24 ? `${segment.slice(0, 24)}…` : segment;
      return { url, label: short ? `${host}/${short}` : host };
    } catch {
      return { url, label: host };
    }
  });
}

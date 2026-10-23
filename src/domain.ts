/**
 * Pure helpers shared by the DGEG client and the MCP tools.
 * Everything in this module is deterministic and side-effect free so it can be
 * unit-tested without a Workers runtime.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Summary {
  count: number;
  min: number;
  max: number;
  avg: number;
  median: number;
}

export const SOURCE =
  "DGEG — Direção-Geral de Energia e Geologia (precoscombustiveis.dgeg.gov.pt)";

export const MAINLAND_NOTE =
  "DGEG publishes station prices for mainland Portugal only (18 districts, 278 concelhos). " +
  "The Azores and Madeira are not covered by this data source.";

const LISBON_TIME_ZONE = "Europe/Lisbon";

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function roundTo(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Parse a DGEG price string into a number of euros.
 * Handles "2,014 €", "2,118 €/litro", "1.234,5 €" and plain numbers.
 */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") return null;

  let normalized: string;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Parse a DGEG unit string such as "€/litro" or "€/kg". */
export function parseUnit(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /€\s*\/\s*([^\s/]+)/.exec(raw);
  if (!match) return null;
  const unit = match[1].toLowerCase();
  return unit === "m³" ? "m3" : unit;
}

export function formatPrice(value: number | null | undefined, unit?: string | null): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const amount = value.toFixed(3).replace(".", ",");
  return unit ? `${amount} €/${unit}` : `${amount} €`;
}

export function summarize(values: readonly number[]): Summary | null {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const total = sorted.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];

  return {
    count: sorted.length,
    min: roundTo(sorted[0]),
    max: roundTo(sorted[sorted.length - 1]),
    avg: roundTo(total / sorted.length),
    median: roundTo(median),
  };
}

export function mapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function lisbonParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: LISBON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hour = read("hour");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Current date in mainland Portugal (Europe/Lisbon), as YYYY-MM-DD. */
export function lisbonToday(now: Date = new Date()): string {
  const parts = lisbonParts(now);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * DGEG timestamps are wall-clock Europe/Lisbon with no offset. Comparing them
 * as UTC epochs keeps the difference correct to within an hour across DST.
 */
export function parseDgegTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0"] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function lisbonWallClockMs(now: Date): number {
  const parts = lisbonParts(now);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function isWithinHours(updated: string, hours: number, now: Date = new Date()): boolean {
  const timestamp = parseDgegTimestamp(updated);
  if (timestamp === null) return false;
  return lisbonWallClockMs(now) - timestamp <= hours * 3_600_000;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export interface DateRangeInput {
  days?: number;
  from?: string;
  to?: string;
  now?: Date;
}

export const MAX_HISTORY_DAYS = 365;

/** Resolve a history window, clamped to 365 days and to today (Lisbon). */
export function buildDateRange(input: DateRangeInput): { from: string; to: string } {
  const today = lisbonToday(input.now ?? new Date());
  const to = isIsoDate(input.to) && input.to <= today ? input.to : today;

  let from: string;
  if (isIsoDate(input.from)) {
    from = input.from;
  } else {
    const days = clamp(Math.trunc(input.days ?? 30), 1, MAX_HISTORY_DAYS);
    from = addDaysIso(to, -(days - 1));
  }

  const earliest = addDaysIso(to, -MAX_HISTORY_DAYS);
  if (from < earliest) from = earliest;
  if (from > to) from = to;

  return { from, to };
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

export interface Match<T> {
  match: T | null;
  candidates: T[];
}

/**
 * Resolve a human name against a list of named items: exact id, exact name,
 * unique substring, then a small edit distance. Ambiguity is reported rather
 * than silently guessed.
 */
export function matchByName<T>(
  items: readonly T[],
  input: string,
  getName: (item: T) => string,
  options: { alias?: (normalized: string) => string; maxCandidates?: number } = {},
): Match<T> {
  const maxCandidates = options.maxCandidates ?? 10;
  const normalizedInput = normalizeText(input);
  const wanted = options.alias ? options.alias(normalizedInput) : normalizedInput;
  if (!wanted) return { match: null, candidates: [] };

  const scored = items
    .map((item) => ({ item, key: normalizeText(getName(item)) }))
    .filter((entry) => entry.key.length > 0);

  const aliased = (key: string) => (options.alias ? options.alias(key) : key);

  const exact = scored.filter((entry) => entry.key === wanted || aliased(entry.key) === wanted);
  if (exact.length === 1) return { match: exact[0].item, candidates: [] };
  if (exact.length > 1) return { match: null, candidates: exact.map((entry) => entry.item) };

  const partial = scored.filter(
    (entry) => entry.key.includes(wanted) || wanted.includes(entry.key),
  );
  if (partial.length === 1) return { match: partial[0].item, candidates: [] };
  if (partial.length > 1) {
    const byLength = [...partial].sort((a, b) => a.key.length - b.key.length);
    if (byLength[0].key.length < byLength[1].key.length) {
      return { match: byLength[0].item, candidates: [] };
    }
    return { match: null, candidates: byLength.slice(0, maxCandidates).map((entry) => entry.item) };
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestItems: T[] = [];
  for (const entry of scored) {
    const distance = levenshtein(entry.key, wanted);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestItems = [entry.item];
    } else if (distance === bestDistance) {
      bestItems.push(entry.item);
    }
  }

  const threshold = wanted.length <= 4 ? 1 : 2;
  if (bestDistance <= threshold) {
    if (bestItems.length === 1) return { match: bestItems[0], candidates: [] };
    return { match: null, candidates: bestItems.slice(0, maxCandidates) };
  }

  return { match: null, candidates: [] };
}

/** Fuel nicknames so callers never need the DGEG numeric ids. */
const FUEL_ALIASES: Record<string, string> = {
  diesel: "gasoleo simples",
  gasoleo: "gasoleo simples",
  "gasoleo rodoviario": "gasoleo simples",
  gasolina: "gasolina simples 95",
  "gasolina 95": "gasolina simples 95",
  "gasolina simples": "gasolina simples 95",
  "gasolina 98": "gasolina 98",
  "95": "gasolina simples 95",
  "98": "gasolina 98",
  gpl: "gpl auto",
  gplauto: "gpl auto",
  "gpl auto": "gpl auto",
  gnr: "gpl auto",
  gas: "gpl auto",
  gnl: "gnl gas natural liquefeito kg",
  gnc: "gnc gas natural comprimido kg",
};

export function fuelAlias(normalized: string): string {
  return FUEL_ALIASES[normalized] ?? normalized;
}

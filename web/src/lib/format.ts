const priceFormatter = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const moneyFormatter = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const distanceFormatter = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });

const UNIT_SUFFIX: Record<string, string> = {
  litro: "€/litro",
  kg: "€/kg",
  m3: "€/m³",
};

export function formatPrice(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const amount = priceFormatter.format(value);
  const suffix = unit ? (UNIT_SUFFIX[unit] ?? `€/${unit}`) : "€";
  return `${amount} ${suffix}`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return moneyFormatter.format(value);
}

export function formatKm(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${distanceFormatter.format(value)} km`;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const text = Number.isInteger(cents)
    ? String(cents)
    : cents.toFixed(1).replace(".", ",");
  return `${text} cênt./L`;
}

/** DGEG publishes wall-clock timestamps without a zone, e.g. "2026-10-20 08:00". */
export function parseDgegDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatRelativeTime(value: string | null | undefined, now: Date = new Date()): string {
  const date = parseDgegDate(value);
  if (!date) return "—";

  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 0) return "agora";
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.round(hours / 24);
  if (days === 1) return "há 1 dia";
  if (days < 31) return `há ${days} dias`;

  const months = Math.round(days / 30);
  return months <= 1 ? "há 1 mês" : `há ${months} meses`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const [, month, day] = value.slice(0, 10).split("-");
  if (!month || !day) return value;
  return `${day}/${month}`;
}

export interface Env {
  DGEG_BASE_URL?: string;
  CACHE_TTL_SECONDS?: string;
  USER_AGENT?: string;
  /** D1 binding holding the standardized discount objects. Optional so tests and
   * degraded deployments can run without the database. */
  DB?: D1Database;
}

export const SERVER_NAME = "cheaper-fuel";
export const SERVER_VERSION = "0.3.0";

export const DEFAULT_DGEG_BASE_URL = "https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb";
export const DEFAULT_USER_AGENT = `cheaper-fuel-mcp/${SERVER_VERSION} (+https://github.com/jorgemgon/cheaper-fuel)`;
export const DEFAULT_CACHE_TTL_SECONDS = 86_400;

export function cacheTtlSeconds(env: Env): number {
  const parsed = Number(env.CACHE_TTL_SECONDS ?? DEFAULT_CACHE_TTL_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_SECONDS;
}

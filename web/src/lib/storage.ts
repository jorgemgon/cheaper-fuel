const PREFIX = "cheaper-fuel:";

export function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be full or disabled; the app keeps working without it.
  }
}

export function removeKey(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

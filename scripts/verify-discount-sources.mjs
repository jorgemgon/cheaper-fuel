#!/usr/bin/env node
/**
 * Detect changes in the official sources backing each discount programme.
 *
 * This NEVER parses or reinterprets a promotion — it only hashes the page text
 * and reports whether it moved since the registry was last verified. A human
 * then reviews the programme and updates data/discounts.seed.json.
 *
 *   npm run discounts:verify            # report only
 *   npm run discounts:verify -- --print # also print hashes to paste into the seed
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const seedPath = path.join(root, "data", "discounts.seed.json");
const USER_AGENT = "cheaper-fuel-mcp/0.2 (+https://github.com/jorgemgon/cheaper-fuel)";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());

function statusOf(entry) {
  if (entry.validFrom && today < entry.validFrom) return "scheduled";
  if (entry.validUntil && today > entry.validUntil) return "expired";
  return "active";
}

function normalize(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function hashUrl(url) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return `sha256:${createHash("sha256").update(normalize(text)).digest("hex")}`;
}

const seed = JSON.parse(await readFile(seedPath, "utf8"));
const entries = seed.discounts ?? [];
const printHashes = process.argv.includes("--print");

const stale = entries.filter((entry) => statusOf(entry) !== "expired");
const byUrl = new Map();
for (const entry of stale) {
  const url = entry.source?.url;
  if (!url) continue;
  if (entry.source?.fetchMode === "manual") {
    byUrl.set(url, { manual: true, ids: [...(byUrl.get(url)?.ids ?? []), entry.id], entry });
    continue;
  }
  const existing = byUrl.get(url) ?? { manual: false, ids: [] };
  existing.ids.push(entry.id);
  existing.entry = entry;
  byUrl.set(url, existing);
}

const changed = [];
for (const [url, info] of byUrl) {
  if (info.manual) {
    console.log(`BLOCKED   ${url} (manual review) — ${info.ids.join(", ")}`);
    continue;
  }
  try {
    const hash = await hashUrl(url);
    const baseline = info.entry.source?.contentHash ?? null;
    if (printHashes) console.log(`HASH      ${info.entry.id} ${hash}`);
    if (!baseline) {
      console.log(`NO_BASE   ${url} — ${info.ids.join(", ")}`);
    } else if (baseline === hash) {
      console.log(`UNCHANGED ${url}`);
    } else {
      console.log(`CHANGED   ${url} — ${info.ids.join(", ")}`);
      changed.push(url);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`ERROR     ${url} — ${message}`);
    changed.push(url);
  }
}

console.log(`\n${byUrl.size} source(s) checked, ${changed.length} needing review.`);
if (changed.length > 0) process.exitCode = 1;

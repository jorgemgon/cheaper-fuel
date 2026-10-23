import { ref, watch } from "vue";

import { readJson, writeJson } from "../lib/storage";

// The dashboard has one price order: the lowest price on the card (after
// discounts). "price" keeps the stored key; the request asks for effective.
export type SortMode = "distance" | "price";
export type SortOrder = "asc" | "desc";
export type ResultLimit = number | "all";
export type QuantityUnit = "litres" | "euros";

export interface Profile {
  version: number;
  fuels: string[];
  cards: string[];
  services: string[];
  /** False until the dashboard has seeded cards/services from the catalogue. */
  discountsInitialised: boolean;
  location: string;
  radiusKm: number;
  limit: ResultLimit;
  sort: SortMode;
  sortOrder: SortOrder;
  /** Fill size used for the spend/save estimate, in litres or euros. */
  quantity: number;
  quantityUnit: QuantityUnit;
}

const PROFILE_VERSION = 6;

const QUANTITY_MIN = 5;
const QUANTITY_MAX = 100;

const DEFAULTS: Profile = {
  version: PROFILE_VERSION,
  fuels: ["Gasóleo simples"],
  cards: [],
  services: [],
  // Seeded with every card/app and service the catalogue knows about, so the
  // first search already shows the best price the user can reach.
  discountsInitialised: false,
  location: "",
  radiusKm: 15,
  // Every station inside the radius: the radius itself is the only cap.
  limit: "all",
  // The main page opens ordered by the lowest price, cheapest first.
  sort: "price",
  sortOrder: "asc",
  quantity: 50,
  quantityUnit: "litres",
};

const stored = readJson<
  Partial<Profile> & { discountMode?: unknown; fillLitres?: number }
>("profile", {});
const initial: Profile = { ...DEFAULTS, ...stored };
// The best-case/guaranteed filter is gone: cards show the best price plus
// every remaining price. Drop the obsolete key instead of persisting it.
delete (initial as Profile & { discountMode?: unknown; fillLitres?: unknown }).discountMode;
// The old fixed fill size becomes the default quantity.
if (stored.quantity === undefined && typeof stored.fillLitres === "number") {
  initial.quantity = Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, Math.round(stored.fillLitres / 5) * 5));
}
delete (initial as Profile & { fillLitres?: unknown }).fillLitres;
// Older builds stored a separate "effective price" order; there is now one
// price order, so fold it into "price".
if ((initial.sort as string) === "effective_price") initial.sort = "price";

// Bumping this resets the stored display settings once, so everyone lands on
// the current defaults instead of ones inherited from an older build. Cards,
// services, fuels and location are preserved; a chosen result limit survives.
const storedVersion = stored.version ?? 1;
if (storedVersion < 4) initial.limit = DEFAULTS.limit;
if (storedVersion < PROFILE_VERSION) {
  initial.sort = DEFAULTS.sort;
  initial.sortOrder = DEFAULTS.sortOrder;
}
initial.version = PROFILE_VERSION;

const profile = ref<Profile>(initial);
watch(profile, (value) => writeJson("profile", value), { deep: true });

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
}

export function useProfile() {
  return {
    profile,
    toggleFuel(fuel: string) {
      const next = toggle(profile.value.fuels, fuel);
      // The API requires at least one fuel; never let the selection go empty.
      profile.value.fuels = next.length > 0 ? next : profile.value.fuels;
    },
    toggleCard(card: string) {
      profile.value.cards = toggle(profile.value.cards, card);
    },
    toggleService(service: string) {
      profile.value.services = toggle(profile.value.services, service);
    },
    setLocation(location: string) {
      profile.value.location = location;
    },
    resetFilters() {
      profile.value.cards = [];
      profile.value.services = [];
    },
  };
}

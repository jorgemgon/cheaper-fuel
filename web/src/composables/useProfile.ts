import { ref, watch } from "vue";

import { readJson, writeJson } from "../lib/storage";

export type SortMode = "distance" | "price" | "effective_price";
export type SortOrder = "asc" | "desc";
export type DiscountMode = "best_case" | "guaranteed";
export type ResultLimit = number | "all";

export interface Profile {
  version: number;
  fuels: string[];
  cards: string[];
  services: string[];
  location: string;
  radiusKm: number;
  limit: ResultLimit;
  sort: SortMode;
  sortOrder: SortOrder;
  discountMode: DiscountMode;
  fillLitres: number;
}

const PROFILE_VERSION = 4;

const DEFAULTS: Profile = {
  version: PROFILE_VERSION,
  fuels: ["Gasóleo simples"],
  cards: [],
  services: [],
  location: "",
  radiusKm: 15,
  // Every station inside the radius: the radius itself is the only cap.
  limit: "all",
  // The main page opens ordered by price, cheapest first.
  sort: "price",
  sortOrder: "asc",
  discountMode: "best_case",
  fillLitres: 50,
};

const stored = readJson<Partial<Profile>>("profile", {});
const initial: Profile = { ...DEFAULTS, ...stored };

// Bumping this resets the stored display settings once, so everyone lands on
// the current defaults instead of ones inherited from an older build. Cards,
// services, fuels and location are preserved.
if ((stored.version ?? 1) < PROFILE_VERSION) {
  initial.sort = DEFAULTS.sort;
  initial.sortOrder = DEFAULTS.sortOrder;
  initial.limit = DEFAULTS.limit;
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

import { ref, watch } from "vue";

import { readJson, writeJson } from "../lib/storage";

export type SortMode = "distance" | "price" | "effective_price";
export type SortOrder = "asc" | "desc";
export type DiscountMode = "best_case" | "guaranteed";

export interface Profile {
  fuels: string[];
  cards: string[];
  services: string[];
  location: string;
  radiusKm: number;
  limit: number;
  sort: SortMode;
  sortOrder: SortOrder;
  discountMode: DiscountMode;
  fillLitres: number;
}

const DEFAULTS: Profile = {
  fuels: ["Gasóleo simples"],
  cards: [],
  services: [],
  location: "",
  radiusKm: 15,
  limit: 5,
  // The main page opens ordered by price, dearest first.
  sort: "price",
  sortOrder: "desc",
  discountMode: "best_case",
  fillLitres: 50,
};

const stored = readJson<Partial<Profile>>("profile", {});
const initial: Profile = { ...DEFAULTS, ...stored };

// Profiles saved before sortOrder existed keep their cards and location but
// adopt the new default ordering.
if (stored.sort !== undefined && stored.sortOrder === undefined) {
  initial.sort = DEFAULTS.sort;
  initial.sortOrder = DEFAULTS.sortOrder;
}

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

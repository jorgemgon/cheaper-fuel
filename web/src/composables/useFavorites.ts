import type { StationInfo } from "@contracts";
import { computed, ref, watch } from "vue";

import {
  normalizeFavorites,
  toggleFavoriteStation,
  updateFavoriteStation,
  type FavoriteStation,
} from "../lib/favorites";
import { readJson, writeJson } from "../lib/storage";

const favorites = ref<FavoriteStation[]>(normalizeFavorites(readJson<unknown>("favorites", [])));

watch(
  favorites,
  (value) => {
    writeJson("favorites", value);
  },
  { deep: true },
);

/** Local, per-device favourites; nothing about them leaves the browser. */
export function useFavorites() {
  const favoriteIds = computed(
    () => new Set(favorites.value.map((favorite) => favorite.station.id)),
  );
  const hasFavorites = computed(() => favorites.value.length > 0);

  function isFavorite(id: number): boolean {
    return favoriteIds.value.has(id);
  }

  function toggle(station: StationInfo, fuel: string): void {
    favorites.value = toggleFavoriteStation(favorites.value, station, fuel);
  }

  function refresh(station: StationInfo, fuel: string): void {
    favorites.value = updateFavoriteStation(favorites.value, station, fuel);
  }

  function remove(id: number): void {
    favorites.value = favorites.value.filter((favorite) => favorite.station.id !== id);
  }

  return { favorites, favoriteIds, hasFavorites, isFavorite, toggle, refresh, remove };
}

import { ref } from "vue";

import { api } from "../api";
import { favoriteFromDetail } from "../lib/favorites";
import { useFavorites } from "./useFavorites";
import { useProfile } from "./useProfile";

const REFRESH_MS = 60_000;

/** Refresh saved stations in small parallel batches; keep snapshots on failure. */
export function useFavoriteRefresh() {
  const { favorites, hasFavorites, refresh } = useFavorites();
  const { profile } = useProfile();
  const loading = ref(false);
  let lastRefresh = 0;

  async function refreshFavorites(force = false): Promise<void> {
    if (!hasFavorites.value) return;
    if (!force && Date.now() - lastRefresh < REFRESH_MS) return;

    loading.value = true;
    const queue = [...favorites.value];
    const profileQuery = {
      cards: profile.value.cards,
      services: profile.value.services,
    };

    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0) {
        const favorite = queue.shift();
        if (!favorite) return;
        try {
          const payload = await api.station(favorite.station.id, profileQuery);
          const detail = payload.result.station;
          if (!detail) continue;
          const updated = favoriteFromDetail(detail, favorite.fuel);
          if (updated) refresh(updated.station, updated.fuel, updated.rows);
        } catch {
          // Offline or station removed: the locally saved snapshot still works.
        }
      }
    });

    await Promise.all(workers);
    lastRefresh = Date.now();
    loading.value = false;
  }

  return { loading, refreshFavorites };
}

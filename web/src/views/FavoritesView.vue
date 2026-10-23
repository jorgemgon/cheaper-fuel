<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";

import MapPanel from "../components/MapPanel.vue";
import StationCard from "../components/StationCard.vue";
import { useFavoriteRefresh } from "../composables/useFavoriteRefresh";
import { useFavorites } from "../composables/useFavorites";
import { useLayoutMode } from "../composables/useLayoutMode";
import { useProfile } from "../composables/useProfile";

const router = useRouter();
const { profile } = useProfile();
const { favorites, hasFavorites } = useFavorites();
const { loading, refreshFavorites } = useFavoriteRefresh();
const layoutMode = useLayoutMode();

const rows = computed(() =>
  favorites.value.map((favorite) => ({ station: favorite.station, fuel: favorite.fuel })),
);

// Removing the last favourite removes the Favoritos tab: go back to Explore.
watch(hasFavorites, (has) => {
  if (!has) void router.replace({ name: "explore" });
});

onMounted(() => {
  if (!hasFavorites.value) {
    void router.replace({ name: "explore" });
    return;
  }
  void refreshFavorites();
});
</script>

<template>
  <section v-if="hasFavorites" class="stack favorites-page">
    <header class="card stack">
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div>
          <h1>Favoritos</h1>
          <p class="muted small">
            Postos guardados neste dispositivo. Os preços são atualizados ao abrir.
          </p>
        </div>
        <RouterLink to="/explore" class="btn btn-ghost small">Explorar postos</RouterLink>
      </div>
    </header>

    <div class="favorites-layout" :class="`favorites-layout--${layoutMode}`">
      <div class="favorites-map">
        <MapPanel :rows="rows" hint="Postos favoritos guardados neste dispositivo." />
      </div>

      <div class="favorites-results stack">
        <div class="row" style="justify-content: space-between">
          <h2>
            {{ favorites.length }}
            {{ favorites.length === 1 ? "posto favorito" : "postos favoritos" }}
          </h2>
          <span v-if="loading" class="badge">a atualizar…</span>
        </div>
        <p class="tiny muted">Toca na estrela para remover.</p>

        <div class="stack">
          <StationCard
            v-for="favorite in favorites"
            :key="favorite.station.id"
            :station="favorite.station"
            :fuel="favorite.fuel"
            show-fuel
            :quantity="profile.quantity"
            :quantity-unit="profile.quantityUnit"
            @focus="() => undefined"
          />
        </div>
      </div>
    </div>
  </section>
</template>

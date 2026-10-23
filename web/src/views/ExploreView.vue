<script setup lang="ts">
import type {
  DiscountProgrammeInfo,
  FindStationsResult,
  MetaResult,
  StationInfo,
} from "@contracts";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { api, ApiError, localizedApiMessage, type StationQuery } from "../api";
import ChipGroup from "../components/ChipGroup.vue";
import EmptyState from "../components/EmptyState.vue";
import MapPanel from "../components/MapPanel.vue";
import StationCard from "../components/StationCard.vue";
import { useGeolocation } from "../composables/useGeolocation";
import { useProfile, type ResultLimit, type SortMode } from "../composables/useProfile";
import { allProfileKeys, buildProfileOptions } from "../lib/discount-labels";
import { fuelColor } from "../lib/fuel-colors";
import { formatDate, formatRelativeTime } from "../lib/format";
import { buildFuelGroups, fuelGroupCount } from "../lib/fuel-groups";
import { GEO_CACHE_TTL_MS, isFresh } from "../lib/geo";
import { buildTierLadders } from "../lib/programme-tiers";
import { readSearchContext, saveSearchContext } from "../lib/search-context";
import { nextSortState } from "../lib/sort-order";
import { readJson, writeJson } from "../lib/storage";

const route = useRoute();
const { profile, toggleFuel, toggleCard, toggleService } = useProfile();
const {
  status: geoStatus,
  coords: geoCoords,
  message: geoMessage,
  locate,
  setCoords,
} = useGeolocation();

const meta = ref<MetaResult | null>(null);
const programmes = ref<DiscountProgrammeInfo[]>([]);
const result = ref<FindStationsResult | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const errorHint = ref<string | null>(null);
const searchedFrom = ref<"geo" | "place" | "picked" | null>(null);
const searchedAt = ref<string | null>(null);

const searchTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const autoSearchEnabled = ref(false);
let searchSequence = 0;
let lastQueryKey: string | null = null;

const AUTO_SEARCH_DELAY_MS = 350;

const fuelOptions = computed(() =>
  (meta.value?.fuels ?? []).map((fuel) => ({
    key: fuel.name,
    label: fuel.name,
    color: fuelColor(fuel.name),
  })),
);
const profileOptions = computed(() => buildProfileOptions(programmes.value));
const cardOptions = computed(() => profileOptions.value.filter((option) => option.group === "card"));
const serviceOptions = computed(() =>
  profileOptions.value.filter((option) => option.group === "service"),
);

const fuels = computed(() => result.value?.result.fuels ?? []);
// One collapsible section per selected fuel; the same station can appear once
// per fuel, so the list key is station + fuel.
const fuelGroups = computed(() => buildFuelGroups(fuels.value));
const stationRows = computed(() => fuelGroups.value.flatMap((group) => group.rows));
const stations = computed<StationInfo[]>(() => stationRows.value.map((row) => row.station));
const multipleFuels = computed(() => fuels.value.length > 1);
const distinctStations = computed(() => new Set(stations.value.map((station) => station.id)).size);
const covered = computed(() => result.value?.result.municipalities_covered ?? []);
const effectiveRadius = computed(() => result.value?.result.effective_radius_km ?? null);
const discountsUnavailable = computed(() => result.value?.discounts_unavailable ?? null);

// Never let the per-fuel cap stay invisible: a station can be found in the
// radius and still not be returned because of the results limit.
const truncatedFuels = computed(() =>
  fuels.value.filter((fuel) => fuel.stations_found > fuel.stations.length),
);
const countLabel = computed(() => {
  const only = fuels.value.length === 1 ? fuels.value[0] : null;
  if (only && only.stations_found > only.stations.length) {
    return `${only.stations.length} de ${only.stations_found} postos`;
  }
  return `${distinctStations.value} postos`;
});

const LIMIT_OPTIONS: Array<{ value: ResultLimit; label: string }> = [
  // Everything inside the radius is the default; the counts are there for
  // slow connections or very wide radii.
  { value: "all", label: "Todos" },
  { value: 10, label: "10" },
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
];

const limitNotice = computed(() =>
  profile.value.limit === "all"
    ? "Todos os postos dentro do raio estão listados."
    : `Limite de ${profile.value.limit} por combustível — muda em "Resultados" para veres o resto.`,
);

const quantityLabel = computed(() =>
  profile.value.quantityUnit === "litres" ? `${profile.value.quantity} L` : `${profile.value.quantity} €`,
);

// Tier ladders (COMBINA 1/2/3+ services) come from the catalogue, not the
// station payload, and only multi-tier programmes get one.
const programmeTiers = computed(() => buildTierLadders(programmes.value));
function tiersFor(programmeId: string | null | undefined) {
  if (!programmeId) return [];
  return programmeTiers.value.get(programmeId) ?? [];
}

const sortOptions: Array<{ key: SortMode; label: string }> = [
  { key: "distance", label: "Distância" },
  { key: "price", label: "Preço" },
];

function setSort(key: SortMode) {
  const next = nextSortState(
    { sort: profile.value.sort, sortOrder: profile.value.sortOrder },
    key,
  );
  profile.value.sort = next.sort;
  profile.value.sortOrder = next.sortOrder;
}

function buildQuery(): StationQuery | null {
  const base: StationQuery = {
    fuels: profile.value.fuels,
    limit: profile.value.limit,
    // The card's headline is the lowest price after discounts, so price order
    // must rank by that same price, not the undiscounted one.
    sort: profile.value.sort === "distance" ? "distance" : "effective_price",
    sort_order: profile.value.sortOrder,
    radius_km: profile.value.radiusKm,
    cards: profile.value.cards,
    services: profile.value.services,
  };

  if (usesPoint.value && geoCoords.value) {
    return {
      ...base,
      latitude: geoCoords.value.latitude,
      longitude: geoCoords.value.longitude,
    };
  }

  const location = profile.value.location.trim();
  if (location.length > 0) return { ...base, location };
  return null;
}

async function search(): Promise<void> {
  cancelScheduledSearch();
  const query = buildQuery();
  if (!query) {
    error.value = "Escolhe um local ou usa a tua localização para começar.";
    errorHint.value = null;
    return;
  }

  const sequence = ++searchSequence;
  lastQueryKey = JSON.stringify(query);
  loading.value = true;
  error.value = null;
  errorHint.value = null;

  try {
    const payload = await api.stations(query);
    // A slower earlier request must not overwrite a newer answer.
    if (sequence !== searchSequence) return;
    result.value = payload;
    searchedAt.value = new Date().toISOString();
    persistSearchContext();
  } catch (caught) {
    if (sequence !== searchSequence) return;
    result.value = null;
    if (caught instanceof ApiError) {
      error.value = caught.message;
      const details = caught.details as { hint?: string } | undefined;
      // A translated message already explains the problem; the server's
      // English hint would only repeat it in the wrong language.
      errorHint.value = localizedApiMessage(caught.code) ? null : (details?.hint ?? null);
    } else {
      error.value = "Não foi possível obter os preços. Verifica a ligação.";
    }
  } finally {
    if (sequence === searchSequence) loading.value = false;
  }
}

const usesPoint = computed(
  () => searchedFrom.value === "geo" || searchedFrom.value === "picked",
);
// The pin is the active search point: your position, or the spot you picked.
const mapPin = computed(() => (usesPoint.value ? geoCoords.value : null));

/** Keep the last successful search so a refresh does not reset the page. */
function persistSearchContext(): void {
  const mode = searchedFrom.value;
  if (!mode) return;

  if (mode === "place") {
    const location = profile.value.location.trim();
    if (location) saveSearchContext({ mode, location });
    return;
  }

  if (geoCoords.value) {
    saveSearchContext({
      mode,
      latitude: geoCoords.value.latitude,
      longitude: geoCoords.value.longitude,
    });
  }
}

function hasSearchContext(): boolean {
  if (usesPoint.value && geoCoords.value) return true;
  return profile.value.location.trim().length > 0;
}

/** A map click or a dropped pin: search from that point instead of a name. */
function pickPoint(point: { latitude: number; longitude: number }): void {
  setCoords(point);
  searchedFrom.value = "picked";
  scheduleSearch();
}

function cancelScheduledSearch(): void {
  if (searchTimer.value !== null) {
    clearTimeout(searchTimer.value);
    searchTimer.value = null;
  }
}

/**
 * Filters re-run the search on their own, debounced so dragging the radius
 * slider or ticking several chips costs one request. The location text field
 * is deliberately not watched: it stays submit-only (Enter / "Procurar").
 */
function scheduleSearch(): void {
  if (!autoSearchEnabled.value || !hasSearchContext()) return;
  const query = buildQuery();
  // A filter change that lands on the query already being fetched (using your
  // location also switches the sort, for instance) needs no second request.
  if (query && JSON.stringify(query) === lastQueryKey) return;
  cancelScheduledSearch();
  searchTimer.value = setTimeout(() => {
    searchTimer.value = null;
    void search();
  }, AUTO_SEARCH_DELAY_MS);
}

watch(
  () => [
    profile.value.fuels,
    profile.value.cards,
    profile.value.services,
    profile.value.radiusKm,
    profile.value.sort,
    profile.value.sortOrder,
    profile.value.limit,
  ],
  scheduleSearch,
  { deep: true },
);

onBeforeUnmount(cancelScheduledSearch);

async function useMyLocation(): Promise<void> {
  const coords = await locate();
  if (!coords) {
    writeJson("geo-consent", "denied");
    return;
  }
  writeJson("geo-consent", "granted");
  writeJson("geo-position", { ...coords, at: Date.now() });
  searchedFrom.value = "geo";
  // Geolocation changes where to search, not how to order: the default stays
  // cheapest first unless the user picked another order.
  await search();
}

async function searchByPlace(): Promise<void> {
  searchedFrom.value = "place";
  await search();
}

onMounted(async () => {
  try {
    const [metaResult, discounts] = await Promise.all([
      api.meta(),
      api.discounts({ status: "all" }),
    ]);
    meta.value = metaResult;
    programmes.value = discounts.result.programs;
    if (profile.value.fuels.length === 0 && metaResult.defaults.fuels.length > 0) {
      profile.value.fuels = metaResult.defaults.fuels;
    }
    // Start with every card/app and service selected so the first search
    // already shows the best price the user can reach. Applied once; a later
    // manual selection is respected.
    if (!profile.value.discountsInitialised) {
      const all = allProfileKeys(profileOptions.value);
      if (all.cards.length + all.services.length > 0) {
        profile.value.cards = all.cards;
        profile.value.services = all.services;
        profile.value.discountsInitialised = true;
      }
    }
  } catch {
    // Offline first load: the controls still work with the persisted profile.
  }

  await runInitialSearch();
  // Only after the first search may filter changes trigger their own requests.
  autoSearchEnabled.value = true;
});

async function runInitialSearch(): Promise<void> {
  // Shareable deep links: /?location=Leiria or /?lat=39.74&lon=-8.81
  const queryLocation = typeof route.query.location === "string" ? route.query.location : null;
  const queryLat = Number(route.query.lat);
  const queryLon = Number(route.query.lon);

  if (queryLocation && queryLocation.trim().length > 0) {
    profile.value.location = queryLocation.trim();
    searchedFrom.value = "place";
    await search();
    return;
  }
  if (Number.isFinite(queryLat) && Number.isFinite(queryLon)) {
    setCoords({ latitude: queryLat, longitude: queryLon });
    // Coordinates from a link are a chosen point, not the device position.
    searchedFrom.value = "picked";
    await search();
    return;
  }

  // Restore the last search so refreshing keeps the location on screen.
  const last = readSearchContext();
  if (last) {
    if (last.mode === "place" && last.location) {
      profile.value.location = last.location;
      searchedFrom.value = "place";
      await search();
      return;
    }
    if (last.latitude !== undefined && last.longitude !== undefined) {
      setCoords({ latitude: last.latitude, longitude: last.longitude });
      searchedFrom.value = last.mode;
      await search();
      return;
    }
  }

  const consent = readJson<string | null>("geo-consent", null);
  const cached = readJson<{ latitude: number; longitude: number; at: number } | null>(
    "geo-position",
    null,
  );
  if (consent === "granted" && cached && isFresh(cached.at, GEO_CACHE_TTL_MS)) {
    setCoords({ latitude: cached.latitude, longitude: cached.longitude });
    searchedFrom.value = "geo";
    await search();
  }
}
</script>

<template>
  <section class="stack">
    <div class="card stack">
      <div class="row" style="justify-content: space-between">
        <div>
          <h1>Preços perto de ti</h1>
          <p class="muted small">Portugal continental · dados publicados pela DGEG</p>
        </div>
        <span v-if="result" class="badge">lido {{ formatDate(result.data_fetched_at) }}</span>
      </div>

      <div class="row">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="geoStatus === 'requesting'"
          @click="useMyLocation"
        >
          {{ geoStatus === "requesting" ? "A localizar…" : "Usar a minha localização" }}
        </button>

        <form class="search-form" @submit.prevent="searchByPlace">
          <input
            v-model="profile.location"
            class="input"
            type="search"
            placeholder="Concelho, localidade ou código postal"
            aria-label="Local de pesquisa"
          />
          <button class="btn" type="submit" :disabled="loading">Procurar</button>
        </form>
      </div>

      <p v-if="geoMessage" class="notice notice-warn tiny">{{ geoMessage }}</p>
      <p v-else-if="searchedFrom === 'geo' && geoCoords" class="tiny muted">
        A usar a tua localização ({{ geoCoords.latitude.toFixed(3) }}, {{ geoCoords.longitude.toFixed(3) }})
        <template v-if="searchedAt"> · atualizado {{ formatRelativeTime(searchedAt) }}</template>
      </p>
      <p v-else-if="searchedFrom === 'picked' && geoCoords" class="tiny muted">
        A procurar em {{ geoCoords.latitude.toFixed(3) }}, {{ geoCoords.longitude.toFixed(3) }}
        <template v-if="searchedAt"> · atualizado {{ formatRelativeTime(searchedAt) }}</template>
      </p>

      <div class="field">
        <label>Combustível</label>
        <ChipGroup :options="fuelOptions" :model-value="profile.fuels" @toggle="toggleFuel" />
      </div>

      <div class="field">
        <label>Cartões e apps</label>
        <ChipGroup :options="cardOptions" :model-value="profile.cards" @toggle="toggleCard" />
      </div>

      <div v-if="serviceOptions.length > 0" class="field">
        <label>Serviços e contratos</label>
        <ChipGroup :options="serviceOptions" :model-value="profile.services" @toggle="toggleService" />
      </div>

      <div class="row" style="align-items: flex-end">
        <div class="field" style="min-width: 10rem; flex: 1">
          <label>Raio: {{ profile.radiusKm }} km</label>
          <input v-model.number="profile.radiusKm" type="range" min="2" max="60" step="1" />
        </div>

        <div class="field" style="min-width: 5.5rem">
          <label for="results-limit">Resultados</label>
          <select id="results-limit" v-model="profile.limit" class="select">
            <option v-for="option in LIMIT_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="field">
          <label>Ordenar</label>
          <div class="tabs">
            <button
              v-for="option in sortOptions"
              :key="option.key"
              type="button"
              class="chip"
              :class="{ 'is-on': profile.sort === option.key }"
              :title="
                profile.sort === option.key
                  ? 'Clica para inverter a ordem'
                  : `Ordenar por ${option.label.toLowerCase()}`
              "
              @click="setSort(option.key)"
            >
              {{ option.label }}
              <template v-if="profile.sort === option.key">{{ profile.sortOrder === "desc" ? "↓" : "↑" }}</template>
            </button>
          </div>
        </div>
      </div>

      <div class="row" style="align-items: flex-end">
        <div class="field" style="min-width: 14rem; flex: 1">
          <label>Quantidade: {{ quantityLabel }}</label>
          <div class="tabs" style="margin-bottom: 0.35rem">
            <button
              type="button"
              class="chip"
              :class="{ 'is-on': profile.quantityUnit === 'litres' }"
              @click="profile.quantityUnit = 'litres'"
            >
              Litros
            </button>
            <button
              type="button"
              class="chip"
              :class="{ 'is-on': profile.quantityUnit === 'euros' }"
              @click="profile.quantityUnit = 'euros'"
            >
              Euros
            </button>
          </div>
          <input v-model.number="profile.quantity" type="range" min="5" max="100" step="5" />
        </div>
      </div>
    </div>

    <p v-if="error" class="notice notice-bad">
      {{ error }} <template v-if="errorHint">{{ errorHint }}</template>
    </p>
    <p v-if="discountsUnavailable" class="notice notice-warn tiny">
      Registo de descontos indisponível — os preços base continuam corretos.
    </p>

    <div v-if="loading" class="grid-cards">
      <div v-for="index in 4" :key="index" class="skeleton" />
    </div>

    <div v-else-if="result" class="explore-layout">
      <MapPanel :rows="stationRows" :pin="mapPin" @pick="pickPoint" />

      <div class="stack">
        <div class="row" style="justify-content: space-between">
          <h2>
            {{ countLabel }}
            <template v-if="covered.length > 0"> · {{ covered.length }} concelhos</template>
            <template v-if="multipleFuels"> · {{ fuels.length }} combustíveis</template>
          </h2>
          <span v-if="effectiveRadius" class="badge">raio {{ effectiveRadius }} km</span>
        </div>

        <p v-if="truncatedFuels.length > 0" class="tiny muted">
          {{ limitNotice }}
        </p>

        <p v-if="covered.length > 0" class="tiny muted">
          {{ covered.map((entry) => entry.municipality).join(", ") }}
        </p>

        <EmptyState
          v-if="stations.length === 0"
          title="Sem postos neste raio"
          message="Aumenta o raio, remove filtros de marca ou escolhe outro concelho."
        />

        <template v-else-if="multipleFuels">
          <details
            v-for="group in fuelGroups"
            :key="group.fuel"
            class="fuel-group"
            :style="{ '--fuel-color': group.color }"
            open
          >
            <summary class="fuel-group-head">
              <span class="fuel-group-title">{{ group.fuel }}</span>
              <span class="tiny muted">{{ fuelGroupCount(group) }}</span>
            </summary>
            <div class="fuel-group-body">
              <p v-if="group.rows.length === 0" class="tiny muted">
                Sem postos neste raio para este combustível.
              </p>
              <StationCard
                v-for="row in group.rows"
                :key="`${row.station.id}-${row.fuel}`"
                :station="row.station"
                :quantity="profile.quantity"
                :quantity-unit="profile.quantityUnit"
                :tiers="tiersFor(row.station.discount?.program_id)"
                @focus="() => undefined"
              />
            </div>
          </details>
        </template>

        <template v-else>
          <StationCard
            v-for="row in stationRows"
            :key="`${row.station.id}-${row.fuel}`"
            :station="row.station"
            :quantity="profile.quantity"
            :quantity-unit="profile.quantityUnit"
            :tiers="tiersFor(row.station.discount?.program_id)"
            @focus="() => undefined"
          />
        </template>

        <p v-if="result.result.note" class="notice tiny">{{ result.result.note }}</p>
      </div>
    </div>

    <!-- An error banner already explains the state; hide the prompt asking to start. -->
    <EmptyState
      v-else-if="!error"
      title="Começa por um local"
      message="Usa a tua localização para ver os postos mais próximos, ou escreve um concelho ou código postal."
    />
  </section>
</template>

<script setup lang="ts">
import type { StationInfo } from "@contracts";
import { computed, onMounted, ref, watch } from "vue";

import { useLeafletMap, type MapPoint } from "../composables/useLeafletMap";
import { formatCents, formatPrice, formatRelativeTime } from "../lib/format";
import { buildPriceRamp } from "../lib/price-ramp";

const props = defineProps<{
  stations: StationInfo[];
  userLocation?: { latitude: number; longitude: number } | null;
}>();

const container = ref<HTMLElement | null>(null);
const { init, setStations, setUser, invalidate, tileFailed } = useLeafletMap(container);

const ramp = computed(() =>
  buildPriceRamp(props.stations.map((station) => station.discount?.effective_price_eur ?? station.price_eur)),
);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(station: StationInfo): string {
  const effective = station.discount?.effective_price_eur ?? null;
  const priceLine =
    effective !== null
      ? `<span style="color:#46d39a;font-weight:700">${formatPrice(effective, station.unit)}</span>
         <s style="opacity:.65">${formatPrice(station.price_eur, station.unit)}</s>`
      : `<strong>${formatPrice(station.price_eur, station.unit)}</strong>`;

  const discountLine = station.discount
    ? `<br/><span style="color:#46d39a">${escapeHtml(station.discount.program_title)} · ${formatCents(
        station.discount.applied_cents,
      )}</span>`
    : "";

  return `<div style="font-size:.82rem;line-height:1.45">
    <strong>${escapeHtml(station.name)}</strong><br/>
    ${escapeHtml(station.address.municipality)}${station.brand ? ` · ${escapeHtml(station.brand)}` : ""}<br/>
    ${priceLine}${discountLine}
    <br/><span style="opacity:.65">atualizado ${formatRelativeTime(station.last_updated)}</span>
  </div>`;
}

function sync(fit = true): void {
  const points: MapPoint[] = props.stations.map((station) => ({
    id: station.id,
    latitude: station.coordinates.latitude,
    longitude: station.coordinates.longitude,
    color: ramp.value.colorFor(station.discount?.effective_price_eur ?? station.price_eur),
    popupHtml: popupHtml(station),
  }));
  setStations(points, fit);
  invalidate();
}

onMounted(() => {
  init();
  sync(true);
});

watch(
  () => props.stations,
  () => sync(true),
  { deep: true },
);

watch(
  () => props.userLocation,
  (value) => {
    if (value) setUser(value.latitude, value.longitude);
  },
  { deep: true },
);

watch(
  () => props.stations.length,
  () => setTimeout(invalidate, 60),
);
</script>

<template>
  <div class="map-panel">
    <div ref="container" class="map-canvas" role="application" aria-label="Mapa de postos de abastecimento" />

    <div v-if="tileFailed" class="map-fallback" style="position: absolute; inset: 0">
      Mapa indisponível — não foi possível carregar os mosaicos. A lista de postos continua disponível.
    </div>

    <div v-if="ramp.legend.length > 0" class="legend">
      <span v-for="entry in ramp.legend" :key="entry.label" class="row" style="gap: 0.25rem">
        <swatch :style="{ background: entry.color }" />
        {{ entry.label }}
      </span>
    </div>
  </div>
</template>

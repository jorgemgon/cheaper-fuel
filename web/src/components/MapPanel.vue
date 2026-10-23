<script setup lang="ts">
import type { StationInfo } from "@contracts";
import { computed, onMounted, ref, watch } from "vue";

import { useLeafletMap, type MapPoint } from "../composables/useLeafletMap";
import { formatCents, formatPrice, formatRelativeTime } from "../lib/format";
import { buildPriceRamp } from "../lib/price-ramp";
import {
  groupRowsByStation,
  markerPrice,
  type StationFuelRow,
  type StationGroup,
} from "../lib/station-groups";

const props = defineProps<{
  rows: StationFuelRow[];
  userLocation?: { latitude: number; longitude: number } | null;
}>();

const container = ref<HTMLElement | null>(null);
const { init, setStations, setUser, invalidate, tileFailed } = useLeafletMap(container);

const groups = computed(() => groupRowsByStation(props.rows));

const ramp = computed(() => buildPriceRamp(groups.value.map((group) => markerPrice(group.station))));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function priceLine(station: StationInfo): string {
  const effective = station.discount?.effective_price_eur ?? null;
  const base = formatPrice(station.price_eur, station.unit);
  const price =
    effective !== null
      ? `<span style="color:#46d39a;font-weight:700">${formatPrice(effective, station.unit)}</span>
         <s style="opacity:.65">${base}</s>`
      : `<strong>${base}</strong>`;
  const discount = station.discount
    ? `<br/><span style="color:#46d39a">${escapeHtml(station.discount.program_title)} · ${formatCents(
        station.discount.applied_cents,
      )}</span>`
    : "";
  return `${price}${discount}`;
}

function popupHtml(group: StationGroup): string {
  const { station } = group;
  const prices = group.fuels
    .map(
      (entry) =>
        `<div style="margin-top:.25rem"><span style="opacity:.7">${escapeHtml(entry.fuel)}</span><br/>${priceLine(entry.station)}</div>`,
    )
    .join("");

  return `<div style="font-size:.82rem;line-height:1.45">
    <strong>${escapeHtml(station.name)}</strong><br/>
    ${escapeHtml(station.address.municipality)}${station.brand ? ` · ${escapeHtml(station.brand)}` : ""}
    ${prices}
    <br/><span style="opacity:.65">atualizado ${formatRelativeTime(station.last_updated)}</span>
  </div>`;
}

function sync(fit = true): void {
  const points: MapPoint[] = groups.value.map((group) => ({
    id: group.station.id,
    latitude: group.station.coordinates.latitude,
    longitude: group.station.coordinates.longitude,
    color: ramp.value.colorFor(markerPrice(group.station)),
    popupHtml: popupHtml(group),
  }));
  setStations(points, fit);
  invalidate();
}

onMounted(() => {
  init();
  sync(true);
});

watch(
  () => props.rows,
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
  () => props.rows.length,
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

<script setup lang="ts">
import type { StationInfo } from "@contracts";

import { formatCents, formatKm, formatRelativeTime } from "../lib/format";

const props = defineProps<{ station: StationInfo }>();
const emit = defineEmits<{ focus: [id: number] }>();

function hasGuaranteedDifference(station: StationInfo): boolean {
  const discount = station.discount;
  return Boolean(discount && discount.guaranteed_cents !== discount.applied_cents);
}
</script>

<template>
  <article class="card station" @mouseenter="emit('focus', props.station.id)">
    <div class="station-head">
      <div>
        <div class="station-name">{{ props.station.name }}</div>
        <div class="station-address">
          {{ props.station.address.municipality }}
          <template v-if="props.station.address.locality"> · {{ props.station.address.locality }}</template>
        </div>
      </div>
      <div class="row" style="gap: 0.35rem; justify-content: flex-end">
        <span v-if="props.station.distance_km !== undefined" class="badge">
          {{ formatKm(props.station.distance_km) }}
        </span>
        <span v-if="props.station.brand" class="badge">{{ props.station.brand }}</span>
      </div>
    </div>

    <div class="row" style="justify-content: space-between; align-items: flex-end">
      <div>
        <div v-if="props.station.discount" class="price price-effective">
          {{ props.station.discount.effective_price_display }}
        </div>
        <div :class="props.station.discount ? 'price-old' : 'price'">
          {{ props.station.price_display }}
        </div>
      </div>
      <div class="tiny muted" style="text-align: right">
        atualizado {{ formatRelativeTime(props.station.last_updated) }}
      </div>
    </div>

    <template v-if="props.station.discount">
      <div class="row">
        <span class="badge badge-good">
          {{ props.station.discount.program_title }}
          <template v-if="props.station.discount.label"> · {{ props.station.discount.label }}</template>
        </span>
        <span class="badge">{{ formatCents(props.station.discount.applied_cents) }}</span>
        <span v-if="hasGuaranteedDifference(props.station)" class="badge">
          garantido {{ formatCents(props.station.discount.guaranteed_cents) }}
        </span>
        <span class="badge">{{ props.station.discount.schedule_label }}</span>
        <span v-if="props.station.discount.stale" class="badge badge-warn">verificar</span>
      </div>
      <p class="tiny muted" style="margin: 0">{{ props.station.discount.description }}</p>
    </template>

    <div v-if="props.station.scheduled_discounts?.length" class="notice notice-warn tiny">
      <div v-for="offer in props.station.scheduled_discounts" :key="offer.program_id">
        <strong>{{ offer.program_title }}</strong> — {{ offer.schedule_label }}<template v-if="offer.next_date">,
        próxima a {{ offer.next_date }}</template>.
        {{ offer.description }}
      </div>
    </div>

    <p v-if="props.station.possible_discounts?.length" class="tiny muted" style="margin: 0">
      Por confirmar:
      {{ props.station.possible_discounts.map((entry) => entry.program_title).join(", ") }}
    </p>

    <p v-if="props.station.locked_discounts?.length" class="tiny muted" style="margin: 0">
      Podias poupar aqui com:
      {{ props.station.locked_discounts.map((entry) => entry.programTitle).join(", ") }}
    </p>

    <div class="row" style="margin-top: auto">
      <a class="btn btn-ghost small" :href="props.station.maps_url" target="_blank" rel="noopener">Abrir no mapa</a>
    </div>
  </article>
</template>

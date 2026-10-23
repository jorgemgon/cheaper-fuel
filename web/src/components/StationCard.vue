<script setup lang="ts">
import type { StationInfo } from "@contracts";
import { computed } from "vue";

import type { QuantityUnit } from "../composables/useProfile";
import { fillEstimate, unitSymbol } from "../lib/fill-costs";
import { formatCents, formatKm, formatMoney, formatPrice, formatQuantity, formatRelativeTime } from "../lib/format";
import { bestPriceDisplay, remainingPriceOptions } from "../lib/price-options";
import {
  formatTierValue,
  tierEffectivePrice,
  tiersForDiscount,
  type ProgrammeTier,
} from "../lib/programme-tiers";
import { formatSchedulePt } from "../lib/schedule";

const props = defineProps<{
  station: StationInfo;
  quantity: number;
  quantityUnit: QuantityUnit;
}>();
const emit = defineEmits<{ focus: [id: number] }>();

const bestPrice = computed(() => bestPriceDisplay(props.station));
const priceOptions = computed(() => remainingPriceOptions(props.station));
const estimate = computed(() => fillEstimate(props.station, props.quantity, props.quantityUnit));
const tiers = computed(() => tiersForDiscount(props.station.discount));

/** The ladder level the applied resolution belongs to. */
function isActiveTier(tier: ProgrammeTier): boolean {
  const discount = props.station.discount;
  if (!discount) return false;
  if (tier.id === (discount.tier?.trim() ?? "")) return true;
  const label = discount.label?.trim();
  if (label && tier.label === label) return true;
  // A flat programme has a single level, which is the applied one by default.
  return tiers.value.length === 1;
}

/** Each level with the price it would give and the spend for the quantity. */
const tierRows = computed(() =>
  tiers.value.map((tier) => {
    const referenceLitres = props.quantityUnit === "litres" ? props.quantity : 50;
    const price = tierEffectivePrice(props.station.price_eur, tier, referenceLitres);
    return {
      tier,
      active: isActiveTier(tier),
      unitPrice: price === null ? null : formatPrice(price, props.station.unit),
      secondary:
        price === null
          ? null
          : props.quantityUnit === "litres"
            ? formatMoney(props.quantity * price)
            : `${formatQuantity(props.quantity / price)} ${unitSymbol(props.station.unit)}`,
    };
  }),
);
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
      <div :class="props.station.discount ? 'price price-effective' : 'price'">
        {{ bestPrice }}
      </div>
      <div class="tiny muted" style="text-align: right">
        atualizado {{ formatRelativeTime(props.station.last_updated) }}
      </div>
    </div>

    <div v-if="priceOptions.length > 0" class="price-options">
      <div v-for="option in priceOptions" :key="option.key" class="price-option">
        <span class="price-option-label">
          {{ option.label }}
          <span v-if="option.unconfirmed" class="price-option-note">a confirmar</span>
        </span>
        <span class="price-option-value">{{ option.priceDisplay }}</span>
      </div>
    </div>

    <div v-if="estimate" class="fill-summary">
      <span class="fill-total">
        <template v-if="props.quantityUnit === 'litres'">
          {{ estimate.quantityLabel }} custam {{ estimate.spendLabel }}
        </template>
        <template v-else>
          {{ estimate.quantityLabel }} dão {{ estimate.litresLabel }}
        </template>
      </span>
      <span v-if="estimate.savingsLabel" class="fill-saving">{{ estimate.savingsLabel }}</span>
    </div>

    <template v-if="props.station.discount">
      <div class="row">
        <span class="badge badge-good">
          {{ props.station.discount.program_title }}
          <template v-if="props.station.discount.label"> · {{ props.station.discount.label }}</template>
        </span>
        <span class="badge">{{ formatCents(props.station.discount.applied_cents) }}</span>
        <span class="badge">{{ formatSchedulePt(props.station.discount.schedule) }}</span>
        <span v-if="props.station.discount.stale" class="badge badge-warn">verificar</span>
      </div>
      <div v-if="tierRows.length > 0" class="tier-ladder">
        <span class="tiny muted">Níveis do programa</span>
        <div class="tier-levels">
          <div
            v-for="row in tierRows"
            :key="row.tier.id"
            class="tier-row"
            :class="{ 'is-on': row.active }"
          >
            <span class="tier-row-label">
              {{ row.tier.label }} · {{ formatTierValue(row.tier) }}
              <template v-if="row.active"> · atual</template>
            </span>
            <span class="tier-row-values">
              <span class="tier-row-price">{{ row.unitPrice }}</span>
              <span v-if="row.secondary" class="tier-row-total">{{ row.secondary }}</span>
            </span>
          </div>
        </div>
      </div>
      <p class="tiny muted" style="margin: 0">{{ props.station.discount.description }}</p>
    </template>

    <div v-if="props.station.scheduled_discounts?.length" class="notice notice-warn tiny">
      <div v-for="offer in props.station.scheduled_discounts" :key="offer.program_id">
        <strong>{{ offer.program_title }}</strong> — {{ formatSchedulePt(offer.schedule) }}<template v-if="offer.next_date">,
        próxima a {{ offer.next_date }}</template>.
        {{ offer.description }}
      </div>
    </div>

    <p v-if="props.station.locked_discounts?.length" class="tiny muted" style="margin: 0">
      Podias poupar aqui com:
      {{ props.station.locked_discounts.map((entry) => entry.programTitle).join(", ") }}
    </p>

    <div class="row" style="margin-top: auto">
      <a class="btn btn-ghost small" :href="props.station.maps_url" target="_blank" rel="noopener">Abrir no mapa</a>
    </div>
  </article>
</template>

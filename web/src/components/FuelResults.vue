<script setup lang="ts">
import type { LayoutMode } from "../composables/useLayoutMode";
import type { QuantityUnit } from "../composables/useProfile";
import { computed, ref, watch } from "vue";

import { resolveActiveFuel, stepFuelIndex } from "../lib/fuel-carousel";
import { fuelGroupCount, type FuelGroup } from "../lib/fuel-groups";
import { tiersForDiscount, type ProgrammeTier } from "../lib/programme-tiers";
import StationCard from "./StationCard.vue";

const props = defineProps<{
  groups: readonly FuelGroup[];
  quantity: number;
  quantityUnit: QuantityUnit;
  tiers: ReadonlyMap<string, ProgrammeTier[]>;
  mode: LayoutMode;
}>();

const isMobile = computed(() => props.mode === "mobile");
const fuelNames = computed(() => props.groups.map((group) => group.fuel));
const activeFuel = ref<string | null>(null);
const activeGroup = computed(
  () => props.groups.find((group) => group.fuel === activeFuel.value) ?? props.groups[0] ?? null,
);
const activeIndex = computed(() =>
  Math.max(0, props.groups.findIndex((group) => group.fuel === activeGroup.value?.fuel)),
);
const showTabs = computed(() => isMobile.value && props.groups.length > 1);

watch(
  fuelNames,
  (names) => {
    activeFuel.value = resolveActiveFuel(names, activeFuel.value);
  },
  { immediate: true },
);

function selectFuel(fuel: string): void {
  activeFuel.value = fuel;
}

function step(delta: number): void {
  const next = stepFuelIndex(props.groups.length, activeIndex.value, delta);
  const group = props.groups[next];
  if (group) activeFuel.value = group.fuel;
}

function onTabKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    step(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    step(-1);
  }
}

let touchStart: { x: number; y: number } | null = null;

function onTouchStart(event: TouchEvent): void {
  const touch = event.touches[0];
  touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function onTouchEnd(event: TouchEvent): void {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  if (touch) {
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    // Horizontal swipe only; vertical gestures must keep scrolling the page.
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      step(dx < 0 ? 1 : -1);
    }
  }
  touchStart = null;
}
</script>

<template>
  <!-- Big and small desktops keep the collapsible sections. -->
  <div v-if="!isMobile" class="stack">
    <details
      v-for="group in props.groups"
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
        <StationCard
          v-for="row in group.rows"
          :key="`${row.station.id}-${row.fuel}`"
          :station="row.station"
          :quantity="props.quantity"
          :quantity-unit="props.quantityUnit"
          :tiers="tiersForDiscount(props.tiers, row.station.discount)"
          @focus="() => undefined"
        />
      </div>
    </details>
  </div>

  <!-- Mobile with a single fuel is just the list. -->
  <div v-else-if="!showTabs" class="stack">
    <StationCard
      v-for="row in activeGroup?.rows ?? []"
      :key="`${row.station.id}-${row.fuel}`"
      :station="row.station"
      :quantity="props.quantity"
      :quantity-unit="props.quantityUnit"
      :tiers="tiersForDiscount(props.tiers, row.station.discount)"
      @focus="() => undefined"
    />
  </div>

  <!-- Mobile with several fuels: tabs + a one-fuel pager. -->
  <div v-else class="fuel-carousel">
    <div
      class="fuel-tabs"
      role="tablist"
      aria-label="Combustíveis"
      tabindex="0"
      @keydown="onTabKeydown"
    >
      <button
        v-for="group in props.groups"
        :key="group.fuel"
        type="button"
        role="tab"
        class="fuel-tab"
        :class="{ 'is-on': group.fuel === activeGroup?.fuel }"
        :style="{ '--fuel-color': group.color }"
        :aria-selected="group.fuel === activeGroup?.fuel"
        @click="selectFuel(group.fuel)"
      >
        <span class="fuel-tab-dot" aria-hidden="true" />
        {{ group.fuel }}
        <span class="fuel-tab-count">{{ group.rows.length }}</span>
      </button>
    </div>

    <section
      class="fuel-pager"
      role="tabpanel"
      :aria-label="activeGroup?.fuel ?? ''"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
      <div class="fuel-pager-head">
        <span class="fuel-pager-title">
          <span class="fuel-pager-dot" :style="{ background: activeGroup?.color }" aria-hidden="true" />
          {{ activeGroup?.fuel }}
        </span>
        <span class="tiny muted">{{ activeGroup ? fuelGroupCount(activeGroup) : "" }}</span>
      </div>
      <Transition name="fuel-slide" mode="out-in">
        <div :key="activeGroup?.fuel ?? 'none'" class="stack">
          <StationCard
            v-for="row in activeGroup?.rows ?? []"
            :key="`${row.station.id}-${row.fuel}`"
            :station="row.station"
            :quantity="props.quantity"
            :quantity-unit="props.quantityUnit"
            :tiers="tiersForDiscount(props.tiers, row.station.discount)"
            @focus="() => undefined"
          />
        </div>
      </Transition>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import { DEFAULT_RADIUS_KM, useProfile, type ResultLimit, type SortMode } from "../composables/useProfile";
import { DEFAULT_QUANTITY, normalizeQuantity, QUANTITY_MAX, QUANTITY_MIN } from "../lib/fill-costs";
import { nextSortState } from "../lib/sort-order";
import ChipGroup from "./ChipGroup.vue";

interface ChipOption {
  key: string;
  label: string;
  color?: string;
}

const props = defineProps<{
  fuelOptions: readonly ChipOption[];
  cardOptions: readonly ChipOption[];
  serviceOptions: readonly ChipOption[];
}>();

const { profile, toggleFuel, toggleCard, toggleService } = useProfile();

const LIMIT_OPTIONS: Array<{ value: ResultLimit; label: string }> = [
  // Everything inside the radius is the default; the counts are there for
  // slow connections or very wide radii.
  { value: "all", label: "Todos" },
  { value: 10, label: "10" },
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
];

const sortOptions: Array<{ key: SortMode; label: string }> = [
  { key: "distance", label: "Distância" },
  { key: "price", label: "Preço" },
];

const quantityInput = ref<HTMLInputElement | null>(null);

function setSort(key: SortMode) {
  const next = nextSortState(
    { sort: profile.value.sort, sortOrder: profile.value.sortOrder },
    key,
  );
  profile.value.sort = next.sort;
  profile.value.sortOrder = next.sortOrder;
}

function clearFuels(): void {
  // No fuel selected means every fuel is requested.
  profile.value.fuels = [];
}

function clearCards(): void {
  profile.value.cards = [];
}

function clearServices(): void {
  profile.value.services = [];
}

function resetRadius(): void {
  profile.value.radiusKm = DEFAULT_RADIUS_KM;
}

function onQuantityInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  // Keep the last valid value while the field is momentarily empty.
  if (input.value.trim() === "") return;
  const next = normalizeQuantity(input.value);
  profile.value.quantity = next;
  if (input.value !== String(next)) input.value = String(next);
}

function syncQuantityInput(): void {
  const input = quantityInput.value;
  if (input && input.value !== String(profile.value.quantity)) {
    input.value = String(profile.value.quantity);
  }
}

function resetQuantity(): void {
  profile.value.quantity = DEFAULT_QUANTITY;
  syncQuantityInput();
}
</script>

<template>
  <div class="stack filters-grid">
    <div class="field">
      <div class="field-head">
        <label>Combustível</label>
        <button v-if="profile.fuels.length > 0" type="button" class="clear-btn" @click="clearFuels">
          Limpar
        </button>
      </div>
      <ChipGroup :options="props.fuelOptions" :model-value="profile.fuels" @toggle="toggleFuel" />
    </div>

    <div class="field">
      <div class="field-head">
        <label>Cartões e apps</label>
        <button v-if="profile.cards.length > 0" type="button" class="clear-btn" @click="clearCards">
          Limpar
        </button>
      </div>
      <ChipGroup :options="props.cardOptions" :model-value="profile.cards" @toggle="toggleCard" />
    </div>

    <div v-if="props.serviceOptions.length > 0" class="field">
      <div class="field-head">
        <label>Serviços e contratos</label>
        <button v-if="profile.services.length > 0" type="button" class="clear-btn" @click="clearServices">
          Limpar
        </button>
      </div>
      <ChipGroup :options="props.serviceOptions" :model-value="profile.services" @toggle="toggleService" />
    </div>

    <div class="filters-row">
      <div class="field" style="min-width: 9rem; flex: 1">
        <div class="field-head">
          <label>Raio: {{ profile.radiusKm }} km</label>
          <button
            v-if="profile.radiusKm !== DEFAULT_RADIUS_KM"
            type="button"
            class="clear-btn"
            @click="resetRadius"
          >
            Repor
          </button>
        </div>
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

    <div class="field">
      <div class="field-head">
        <label for="quantity">Quantidade</label>
        <button
          v-if="profile.quantity !== DEFAULT_QUANTITY"
          type="button"
          class="clear-btn"
          @click="resetQuantity"
        >
          Repor
        </button>
      </div>
      <div class="row" style="gap: 0.5rem; align-items: center">
        <div class="tabs">
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
        <input
          id="quantity"
          ref="quantityInput"
          class="input quantity-input"
          type="number"
          inputmode="numeric"
          :min="QUANTITY_MIN"
          :max="QUANTITY_MAX"
          step="1"
          :value="profile.quantity"
          aria-label="Quantidade"
          @input="onQuantityInput"
          @blur="syncQuantityInput"
        />
      </div>
      <input v-model.number="profile.quantity" type="range" :min="QUANTITY_MIN" :max="QUANTITY_MAX" step="1" />
    </div>
  </div>
</template>

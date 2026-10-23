<script setup lang="ts">
import type { MarketOverviewResult, MetaResult } from "@contracts";
import { computed, onMounted, ref } from "vue";

import { api, ApiError } from "../api";
import ChipGroup from "../components/ChipGroup.vue";
import EmptyState from "../components/EmptyState.vue";
import FuelBarChart from "../components/FuelBarChart.vue";
import StatCard from "../components/StatCard.vue";
import { formatCents, formatPrice } from "../lib/format";

const meta = ref<MetaResult | null>(null);
const selected = ref<string[]>([]);
const district = ref("");
const municipality = ref("");
const data = ref<MarketOverviewResult | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const options = computed(() =>
  (meta.value?.fuels ?? []).map((fuel) => ({ key: fuel.name, label: fuel.name })),
);

function toggleFuel(name: string) {
  const next = selected.value.includes(name)
    ? selected.value.filter((item) => item !== name)
    : [...selected.value, name];
  selected.value = next.length > 0 ? next : selected.value;
}

async function load(): Promise<void> {
  if (selected.value.length === 0) return;
  loading.value = true;
  error.value = null;
  try {
    data.value = await api.market({
      fuels: selected.value,
      district: district.value.trim() || undefined,
      municipality: municipality.value.trim() || undefined,
    });
  } catch (caught) {
    data.value = null;
    error.value = caught instanceof ApiError ? caught.message : "Não foi possível carregar o mercado.";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    meta.value = await api.meta();
    selected.value = ["Gasóleo simples", "Gasolina simples 95", "Gasolina 98"];
    await load();
  } catch {
    error.value = "Não foi possível contactar o servidor.";
  }
});
</script>

<template>
  <section class="stack">
    <div class="card stack">
      <div>
        <h1>Mercado</h1>
        <p class="muted small">Estatísticas por combustível, nacional ou por concelho/distrito.</p>
      </div>

      <div class="field">
        <label>Combustíveis</label>
        <ChipGroup :options="options" :model-value="selected" @toggle="toggleFuel" />
      </div>

      <div class="row">
        <div class="field" style="flex: 1; min-width: 12rem">
          <label>Distrito (opcional)</label>
          <input v-model="district" class="input" placeholder="ex.: Porto" @keyup.enter="load" />
        </div>
        <div class="field" style="flex: 1; min-width: 12rem">
          <label>Concelho (opcional)</label>
          <input v-model="municipality" class="input" placeholder="ex.: Matosinhos" @keyup.enter="load" />
        </div>
        <button class="btn btn-primary" type="button" :disabled="loading" @click="load">
          {{ loading ? "A carregar…" : "Atualizar" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="notice notice-bad">{{ error }}</p>

    <div v-if="loading" class="grid-cards">
      <div v-for="index in 3" :key="index" class="skeleton" />
    </div>

    <template v-else-if="data">
      <div class="card stack">
        <h2>{{ data.result.scope }}</h2>
        <FuelBarChart :fuels="data.result.fuels" />
      </div>

      <div v-for="fuel in data.result.fuels" :key="fuel.fuel" class="card stack">
        <div class="row" style="justify-content: space-between">
          <h3>{{ fuel.fuel }}</h3>
          <span class="badge">{{ fuel.stations }} postos</span>
        </div>

        <div class="stat-grid">
          <StatCard label="Média" :value="formatPrice(fuel.price_avg, fuel.unit)" tone="good" />
          <StatCard label="Mínimo" :value="formatPrice(fuel.price_min, fuel.unit)" />
          <StatCard label="Mediana" :value="formatPrice(fuel.price_median, fuel.unit)" />
          <StatCard label="Máximo" :value="formatPrice(fuel.price_max, fuel.unit)" />
          <StatCard label="Amplitude" :value="formatPrice(fuel.price_spread, fuel.unit)" />
        </div>

        <div v-if="fuel.observed_discount_national" class="notice tiny">
          Desconto observado (nacional, {{ fuel.observed_discount_national.date }}):
          <strong>{{ formatCents(fuel.observed_discount_national.avg_discount_eur * 100) }}</strong>
          em média, ponderado pela DGEG. Não é regional e não se soma aos descontos do catálogo.
        </div>

        <div>
          <h3 style="margin-bottom: 0.35rem">Mais baratos</h3>
          <div class="table-scroll">
            <table class="data">
              <thead>
                <tr>
                  <th>Posto</th>
                  <th>Concelho</th>
                  <th>Preço</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="station in fuel.cheapest" :key="`${fuel.fuel}-${station.id}`">
                  <td>{{ station.name }}</td>
                  <td>{{ station.address.municipality }}</td>
                  <td>{{ station.price_display }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p class="tiny muted">{{ data.result.note }}</p>
    </template>

    <EmptyState v-else title="Sem dados" message="Escolhe pelo menos um combustível e atualiza." />
  </section>
</template>

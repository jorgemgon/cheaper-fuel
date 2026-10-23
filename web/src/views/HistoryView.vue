<script setup lang="ts">
import type { MetaResult, PriceHistoryResult } from "@contracts";
import { computed, onMounted, ref } from "vue";

import { api, ApiError } from "../api";
import DiscountBarChart from "../components/DiscountBarChart.vue";
import EmptyState from "../components/EmptyState.vue";
import PriceLineChart from "../components/PriceLineChart.vue";
import StatCard from "../components/StatCard.vue";
import { formatCents, formatDate, formatPrice } from "../lib/format";

const meta = ref<MetaResult | null>(null);
const fuel = ref("Gasóleo simples");
const days = ref(30);
const data = ref<PriceHistoryResult | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const options = computed(() => meta.value?.fuels ?? []);
const series = computed(() => data.value?.result.fuels[0] ?? null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await api.history({ fuels: [fuel.value], days: days.value });
  } catch (caught) {
    data.value = null;
    error.value = caught instanceof ApiError ? caught.message : "Não foi possível carregar o histórico.";
  } finally {
    loading.value = false;
  }
}

function setDays(value: number) {
  days.value = value;
  void load();
}

onMounted(async () => {
  try {
    meta.value = await api.meta();
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
        <h1>Histórico</h1>
        <p class="muted small">
          Média nacional diária publicada pela DGEG. Não existe histórico por posto ou concelho.
        </p>
      </div>

      <div class="row" style="align-items: flex-end">
        <div class="field" style="min-width: 14rem; flex: 1">
          <label>Combustível</label>
          <select v-model="fuel" class="select" @change="load">
            <option v-for="option in options" :key="option.id" :value="option.name">
              {{ option.name }}
            </option>
          </select>
        </div>

        <div class="field">
          <label>Período</label>
          <div class="tabs">
            <button
              v-for="value in [30, 90, 365]"
              :key="value"
              type="button"
              class="chip"
              :class="{ 'is-on': days === value }"
              @click="setDays(value)"
            >
              {{ value }} dias
            </button>
          </div>
        </div>
      </div>
    </div>

    <p v-if="error" class="notice notice-bad">{{ error }}</p>

    <div v-if="loading" class="skeleton" style="height: 18rem" />

    <template v-else-if="series">
      <div class="stat-grid">
        <StatCard
          label="Último dia"
          :value="formatPrice(series.last_avg, series.unit)"
          :hint="formatDate(series.last_date)"
          tone="good"
        />
        <StatCard
          label="Variação"
          :value="series.change_percent !== null ? `${series.change_percent > 0 ? '+' : ''}${series.change_percent}%` : '—'"
          :hint="formatPrice(series.change_eur, series.unit)"
          :tone="series.change_eur !== null && series.change_eur > 0 ? 'warn' : 'good'"
        />
        <StatCard label="Mínimo do período" :value="formatPrice(series.period_min_avg, series.unit)" />
        <StatCard label="Máximo do período" :value="formatPrice(series.period_max_avg, series.unit)" />
        <StatCard
          v-if="series.discount_summary"
          label="Desconto médio"
          :value="formatCents(series.discount_summary.avg_discount_eur * 100)"
          :hint="`${series.discount_summary.days_with_discount} dias com desconto`"
          tone="warn"
        />
      </div>

      <div class="card stack">
        <h2>Média com e sem desconto</h2>
        <PriceLineChart :points="series.points" :unit="series.unit" />
      </div>

      <div class="card stack">
        <h2>Desconto observado por dia</h2>
        <DiscountBarChart :points="series.points" />
        <p class="tiny muted">
          Diferença entre a média sem desconto e a média praticada. É nacional e inclui cartões de frota e
          semelhantes.
        </p>
      </div>

      <div class="card stack">
        <h2>Dados</h2>
        <div class="table-scroll">
          <table class="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Média</th>
                <th>Sem desconto</th>
                <th>Desconto</th>
                <th>Mín.</th>
                <th>Máx.</th>
                <th>Postos</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in [...series.points].reverse()" :key="point.date">
                <td>{{ formatDate(point.date) }}</td>
                <td>{{ formatPrice(point.avg, series.unit) }}</td>
                <td>{{ formatPrice(point.avg_without_discount, series.unit) }}</td>
                <td>{{ formatCents((point.avg_discount_eur ?? 0) * 100) }}</td>
                <td>{{ formatPrice(point.min, series.unit) }}</td>
                <td>{{ formatPrice(point.max, series.unit) }}</td>
                <td>{{ point.stations }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p class="tiny muted">{{ data?.result.note }}</p>
    </template>

    <EmptyState v-else title="Sem histórico" message="Escolhe outro combustível ou período." />
  </section>
</template>

<script setup lang="ts">
import type { ChartOptions } from "chart.js";
import type { MarketFuelStats } from "@contracts";
import { computed } from "vue";
import { Bar } from "vue-chartjs";

import { AXIS_COLOR, CHART_TOOLTIP } from "../lib/charts";
import { formatPrice } from "../lib/format";
import { buildPriceRamp } from "../lib/price-ramp";

const props = defineProps<{ fuels: MarketFuelStats[] }>();

const ramp = computed(() => buildPriceRamp(props.fuels.map((fuel) => fuel.price_avg)));

const data = computed(() => ({
  labels: props.fuels.map((fuel) => fuel.fuel),
  datasets: [
    {
      label: "Preço médio",
      data: props.fuels.map((fuel) => fuel.price_avg),
      backgroundColor: props.fuels.map((fuel) => ramp.value.colorFor(fuel.price_avg)),
      borderRadius: 6,
      maxBarThickness: 46,
    },
  ],
}));

const options = computed<ChartOptions<"bar">>(() => ({
  indexAxis: "y",
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      ...CHART_TOOLTIP,
      callbacks: {
        label: (context) => {
          const fuel = props.fuels[context.dataIndex];
          const min = fuel?.price_min !== null && fuel?.price_min !== undefined ? formatPrice(fuel.price_min, fuel.unit) : "—";
          const max = fuel?.price_max !== null && fuel?.price_max !== undefined ? formatPrice(fuel.price_max, fuel.unit) : "—";
          return `Média ${formatPrice(Number(context.parsed.x), fuel?.unit)} · min ${min} · max ${max}`;
        },
      },
    },
  },
  scales: {
    x: { ticks: { color: AXIS_COLOR }, grid: { color: "rgba(34, 48, 61, 0.6)" } },
    y: { ticks: { color: AXIS_COLOR }, grid: { display: false } },
  },
}));
</script>

<template>
  <div class="chart-wrap" :style="{ height: `${Math.max(160, props.fuels.length * 54)}px` }">
    <Bar :data="data" :options="options" />
  </div>
</template>

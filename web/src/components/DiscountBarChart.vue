<script setup lang="ts">
import type { ChartOptions } from "chart.js";
import type { HistoryPoint } from "@contracts";
import { computed } from "vue";
import { Bar } from "vue-chartjs";

import { AXIS_COLOR, CHART_TOOLTIP } from "../lib/charts";
import { formatCents, formatDay } from "../lib/format";

const props = defineProps<{ points: HistoryPoint[] }>();

const data = computed(() => ({
  labels: props.points.map((point) => formatDay(point.date)),
  datasets: [
    {
      label: "Desconto observado",
      data: props.points.map((point) => (point.avg_discount_eur ?? 0) * 100),
      backgroundColor: "rgba(240, 180, 41, 0.65)",
      borderColor: "#f0b429",
      borderWidth: 1,
      borderRadius: 3,
    },
  ],
}));

const options = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      ...CHART_TOOLTIP,
      callbacks: { label: (context) => formatCents(Number(context.parsed.y)) },
    },
  },
  scales: {
    x: { ticks: { color: AXIS_COLOR, maxTicksLimit: 8 }, grid: { display: false } },
    y: {
      beginAtZero: true,
      ticks: { color: AXIS_COLOR, callback: (value) => `${value} c` },
      grid: { color: "rgba(34, 48, 61, 0.6)" },
    },
  },
}));
</script>

<template>
  <div class="chart-wrap" style="height: 180px">
    <Bar :data="data" :options="options" />
  </div>
</template>

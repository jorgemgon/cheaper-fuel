<script setup lang="ts">
import type { ChartOptions } from "chart.js";
import type { HistoryPoint } from "@contracts";
import { computed } from "vue";
import { Line } from "vue-chartjs";

import { AXIS_COLOR, CHART_TOOLTIP } from "../lib/charts";
import { formatDay, formatPrice } from "../lib/format";

const props = defineProps<{ points: HistoryPoint[]; unit?: string | null }>();

const data = computed(() => ({
  labels: props.points.map((point) => formatDay(point.date)),
  datasets: [
    {
      label: "Sem desconto",
      data: props.points.map((point) => point.avg_without_discount),
      borderColor: "#8aa1b6",
      backgroundColor: "rgba(138, 161, 182, 0.10)",
      borderDash: [4, 4],
      pointRadius: 0,
      borderWidth: 1.5,
      tension: 0.3,
      fill: false,
    },
    {
      label: "Média praticada",
      data: props.points.map((point) => point.avg),
      borderColor: "#46d39a",
      backgroundColor: "rgba(70, 211, 154, 0.16)",
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.3,
      fill: true,
    },
  ],
}));

const options = computed<ChartOptions<"line">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { labels: { boxWidth: 12, usePointStyle: true } },
    tooltip: {
      ...CHART_TOOLTIP,
      callbacks: {
        label: (context) => `${context.dataset.label}: ${formatPrice(context.parsed.y, props.unit ?? "litro")}`,
      },
    },
  },
  scales: {
    x: { ticks: { color: AXIS_COLOR, maxTicksLimit: 8 }, grid: { display: false } },
    y: { ticks: { color: AXIS_COLOR }, grid: { color: "rgba(34, 48, 61, 0.6)" } },
  },
}));
</script>

<template>
  <div class="chart-wrap">
    <Line :data="data" :options="options" />
  </div>
</template>

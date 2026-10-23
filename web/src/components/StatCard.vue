<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn";
}>();
</script>

<template>
  <div class="stat">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value" :style="tone === 'good' ? 'color:var(--good)' : tone === 'warn' ? 'color:var(--warn)' : ''">
      {{ value }}
    </div>
    <div v-if="hint" class="tiny muted">{{ hint }}</div>
  </div>
</template>

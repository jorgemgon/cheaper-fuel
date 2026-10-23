<script setup lang="ts">
defineProps<{ title: string; message?: string }>();
</script>

<template>
  <div class="empty">
    <strong>{{ title }}</strong>
    <p v-if="message" class="small" style="max-width: 34rem">{{ message }}</p>
    <slot />
  </div>
</template>

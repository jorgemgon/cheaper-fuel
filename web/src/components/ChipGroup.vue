<script setup lang="ts">
export interface ChipOption {
  key: string;
  label: string;
  /** Optional identity colour (fuel chips), shown as a dot and on selection. */
  color?: string;
}

const props = defineProps<{
  options: readonly ChipOption[];
  modelValue: readonly string[];
  ariaLabel?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ toggle: [key: string] }>();
</script>

<template>
  <div class="chips" role="group" :aria-label="ariaLabel">
    <button
      v-for="option in props.options"
      :key="option.key"
      type="button"
      class="chip"
      :class="{ 'is-on': props.modelValue.includes(option.key) }"
      :style="option.color ? { '--chip-color': option.color } : undefined"
      :aria-pressed="props.modelValue.includes(option.key)"
      :disabled="props.disabled"
      @click="emit('toggle', option.key)"
    >
      <span v-if="option.color" class="chip-dot" aria-hidden="true" />
      {{ option.label }}
    </button>
  </div>
</template>

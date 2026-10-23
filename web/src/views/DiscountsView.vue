<script setup lang="ts">
import type { DiscountEntryInfo, DiscountProgrammeInfo } from "@contracts";
import { computed, onMounted, ref } from "vue";

import { api, ApiError } from "../api";
import ChipGroup from "../components/ChipGroup.vue";
import EmptyState from "../components/EmptyState.vue";
import { labelForRequirement } from "../lib/discount-labels";
import { formatCents, formatDate, formatMoney } from "../lib/format";

const programmes = ref<DiscountProgrammeInfo[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const supplier = ref<string | null>(null);
const status = ref<"all" | "active" | "scheduled" | "expired">("all");

const supplierOptions = computed(() => {
  const suppliers = new Set(programmes.value.map((programme) => programme.supplier));
  return [...suppliers].sort((a, b) => a.localeCompare(b, "pt")).map((name) => ({ key: name, label: name }));
});

const visible = computed(() =>
  programmes.value
    .filter((programme) => (supplier.value ? programme.supplier === supplier.value : true))
    .filter((programme) => (status.value === "all" ? true : programme.status === status.value)),
);

function toggleSupplier(key: string) {
  supplier.value = supplier.value === key ? null : key;
}

function statusClass(value: string): string {
  if (value === "active") return "badge badge-good";
  if (value === "scheduled") return "badge badge-warn";
  return "badge badge-bad";
}

function statusLabel(value: string): string {
  return value === "active" ? "ativo" : value === "scheduled" ? "agendado" : "terminado";
}

function formatValue(discount: DiscountEntryInfo): string {
  if (discount.value === null || discount.value_type === null) return "não quantificado";
  if (discount.value_type === "cents_per_litre") return formatCents(discount.value);
  if (discount.value_type === "percent") return `${discount.value}%`;
  return `${formatMoney(discount.value)} por abastecimento`;
}

function sourceLabel(source: string): string {
  if (source.includes(".pdf")) return "regulamento";
  try {
    return new URL(source).hostname;
  } catch {
    return source;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const result = await api.discounts({ status: "all" });
    programmes.value = result.result.programs;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : "Não foi possível carregar os descontos.";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="stack">
    <div class="card stack">
      <div class="row" style="justify-content: space-between">
        <div>
          <h1>Descontos</h1>
          <p class="muted small">
            Programas de fornecedores e parceiros. O estado é sempre calculado a partir das datas de validade.
          </p>
        </div>
        <span class="badge">{{ visible.length }} programas</span>
      </div>

      <div class="field">
        <label>Fornecedor</label>
        <ChipGroup :options="supplierOptions" :model-value="supplier ? [supplier] : []" @toggle="toggleSupplier" />
      </div>

      <div class="field">
        <label>Estado</label>
        <div class="tabs">
          <button
            v-for="option in ['all', 'active', 'scheduled', 'expired'] as const"
            :key="option"
            type="button"
            class="chip"
            :class="{ 'is-on': status === option }"
            @click="status = option"
          >
            {{ option === "all" ? "Todos" : statusLabel(option) }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="notice notice-bad">{{ error }}</p>

    <div v-if="loading" class="grid-cards">
      <div v-for="index in 3" :key="index" class="skeleton" style="height: 12rem" />
    </div>

    <template v-else>
      <article v-for="programme in visible" :key="programme.program_id" class="card stack">
        <div class="row" style="justify-content: space-between">
          <div>
            <h2 style="margin: 0">{{ programme.program_title }}</h2>
            <p class="tiny muted" style="margin: 0.2rem 0 0">
              {{ programme.supplier }}
              <template v-if="programme.partners.length"> × {{ programme.partners.join(", ") }}</template>
              · {{ programme.kind }}
            </p>
          </div>
          <div class="row" style="gap: 0.3rem; justify-content: flex-end">
            <span :class="statusClass(programme.status)">{{ statusLabel(programme.status) }}</span>
            <span class="badge">{{ programme.confidence }}</span>
            <span v-if="programme.stale" class="badge badge-warn">proveniência antiga</span>
            <span v-if="!programme.quantified" class="badge">não quantificado</span>
          </div>
        </div>

        <div v-for="discount in programme.discounts" :key="discount.id" class="notice" style="margin: 0">
          <div class="row" style="justify-content: space-between">
            <strong>{{ discount.tier_label ?? discount.tier ?? "Benefício" }}</strong>
            <span class="badge">{{ formatValue(discount) }}</span>
          </div>
          <p class="small" style="margin: 0.35rem 0">{{ discount.description }}</p>
          <div class="row tiny muted" style="gap: 0.5rem">
            <span>Mecânica: {{ discount.channel }} / {{ discount.combine }}</span>
            <span v-if="discount.schedule.kind !== 'always'">Quando: todos os dias</span>
            <span v-if="discount.caps.litresPerFill">Máx. {{ discount.caps.litresPerFill }} L por abastecimento</span>
            <span v-if="discount.caps.litresPerYear">Máx. {{ discount.caps.litresPerYear }} L por ano</span>
            <span v-if="discount.valid_from || discount.valid_until">
              Validade:
              {{ discount.valid_from ? formatDate(discount.valid_from) : "—" }} a
              {{ discount.valid_until ? formatDate(discount.valid_until) : "—" }}
            </span>
          </div>
          <div v-if="discount.requires.length > 0" class="row" style="gap: 0.3rem; margin-top: 0.35rem">
            <span v-for="requirement in discount.requires" :key="requirement" class="badge">
              {{ labelForRequirement(requirement) }}
            </span>
          </div>
        </div>

        <p class="tiny muted" style="margin: 0">
          Fontes:
          <a v-for="source in [...new Set(programme.discounts.map((entry) => entry.source.url))]" :key="source" :href="source" target="_blank" rel="noopener">
            {{ sourceLabel(source) }}
          </a>
        </p>
      </article>

      <EmptyState
        v-if="visible.length === 0"
        title="Sem programas para este filtro"
        message="Limpa o filtro de fornecedor ou escolhe outro estado."
      />

      <p class="tiny muted">
        Os descontos são condicionais e informativos. As condições pertencem aos operadores e devem ser
        confirmadas no posto.
      </p>
    </template>
  </section>
</template>

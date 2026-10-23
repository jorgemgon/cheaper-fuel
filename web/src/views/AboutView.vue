<script setup lang="ts">
import type { MetaResult } from "@contracts";
import { onMounted, ref } from "vue";

import { api } from "../api";

const meta = ref<MetaResult | null>(null);

const origin = typeof window !== "undefined" ? window.location.origin : "";
const mcpCommand = `claude mcp add --transport http cheaper-fuel ${origin}/mcp`;

onMounted(async () => {
  try {
    meta.value = await api.meta();
  } catch {
    meta.value = null;
  }
});
</script>

<template>
  <section class="stack">
    <div class="card stack">
      <h1>cheaper-fuel</h1>
      <p>
        Preços de combustível nos postos de abastecimento de <strong>Portugal continental</strong>, com
        descontos de fornecedores e cadeias de distribuição aplicados ao preço final.
      </p>
      <p class="small muted">
        Os dados de base são publicados pela DGEG, que os disponibiliza gratuitamente para reutilização com
        identificação da fonte e da data de atualização de cada preço. Ambas são apresentadas em cada resultado.
      </p>
      <p class="small muted">
        Os preços são comunicados pelos operadores dos postos, não medidos pela DGEG. Os descontos são
        condições comerciais dos operadores e das cadeias, sujeitas a alterações.
      </p>
      <p v-if="meta" class="tiny muted">
        Versão {{ meta.version }} · dados lidos em {{ meta.data_fetched_at ?? "—" }} · cache de
        {{ Math.round(meta.notes.cache_ttl_seconds / 3600) }} h
      </p>
    </div>

    <div class="card stack">
      <h2>O que está incluído</h2>
      <ul class="small stacked-list">
        <li><strong>Favoritos</strong> — os postos que guardaste neste dispositivo, com todos os combustíveis e preços atualizados.</li>
        <li><strong>Explorar</strong> — postos perto de ti ou de um concelho, com preço efetivo após descontos.</li>
        <li><strong>Mercado</strong> — médias, mínimos, máximos e amplitude por combustível.</li>
        <li><strong>Histórico</strong> — média nacional diária e desconto observado.</li>
        <li><strong>Descontos</strong> — catálogo normalizado, com condições, tetos e validade.</li>
      </ul>
    </div>

    <div class="card stack">
      <h2>Servidor MCP</h2>
      <p class="small">
        O mesmo backend expõe um servidor MCP para agentes (Claude, Codex, etc.) e uma API JSON.
      </p>
      <pre class="small" style="overflow-x: auto"><code>{{ mcpCommand }}</code></pre>
      <p class="tiny muted">
        <a href="/docs">Documentação do MCP</a> · <a href="/api">API JSON</a> ·
        <a href="/health">Estado do serviço</a>
      </p>
    </div>

    <div class="card stack">
      <h2>Privacidade</h2>
      <p class="small muted">
        A localização é pedida apenas quando carregas em “Usar a minha localização” e é guardada no teu
        dispositivo (posição em cache e preferência). Nada é enviado para um servidor além das coordenadas
        necessárias ao pedido de preços. Não há contas nem dados pessoais armazenados.
      </p>
    </div>

    <div class="notice notice-warn">
      <strong>Cobertura.</strong> Apenas Portugal continental. Os Açores e a Madeira não são publicados pela DGEG.
    </div>
  </section>
</template>

<style scoped>
.stacked-list {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
</style>

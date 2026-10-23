<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const route = useRoute();
const online = ref(typeof navigator === "undefined" ? true : navigator.onLine);
const installEvent = ref<BeforeInstallPromptEvent | null>(null);
const standalone = ref(false);

function syncOnline() {
  online.value = navigator.onLine;
}

function captureInstall(event: Event) {
  event.preventDefault();
  installEvent.value = event as BeforeInstallPromptEvent;
}

async function install() {
  const event = installEvent.value;
  if (!event) return;
  await event.prompt();
  installEvent.value = null;
}

onMounted(() => {
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  window.addEventListener("beforeinstallprompt", captureInstall);
  standalone.value = window.matchMedia("(display-mode: standalone)").matches;
});

onBeforeUnmount(() => {
  window.removeEventListener("online", syncOnline);
  window.removeEventListener("offline", syncOnline);
  window.removeEventListener("beforeinstallprompt", captureInstall);
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="brand"><span class="brand-dot" /> cheaper-fuel</RouterLink>
      <nav class="nav" aria-label="Navegação principal">
        <RouterLink to="/">Explorar</RouterLink>
        <RouterLink to="/overview">Mercado</RouterLink>
        <RouterLink to="/history">Histórico</RouterLink>
        <RouterLink to="/discounts">Descontos</RouterLink>
        <RouterLink to="/about">Sobre</RouterLink>
      </nav>
      <button v-if="installEvent && !standalone" class="btn btn-ghost small" type="button" @click="install">
        Instalar
      </button>
    </header>

    <div v-if="!online" class="banner">Estás offline — a mostrar os últimos dados guardados.</div>

    <main class="app-main" :class="{ 'app-main--wide': Boolean(route.meta.wide) }">
      <RouterView />
    </main>

    <footer class="app-footer">
      <p>
        Preços comunicados pelos postos, publicados pela DGEG. Não é uma cotação em tempo real.
      </p>
      <p>
        <a href="/docs">Documentação do servidor MCP</a> · <a href="/api">API JSON</a>
      </p>
    </footer>
  </div>
</template>

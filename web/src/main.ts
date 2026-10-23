import { createApp } from "vue";

import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

createApp(App).use(router).mount("#app");

// When a new service worker takes control, a newer build is live. Reload once so
// the page never keeps an old index.html that points at pruned asset hashes —
// which otherwise renders a blank screen until the user reloads manually.
// The guard keeps the very first registration (page loaded without a controller)
// from triggering a pointless reload.
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

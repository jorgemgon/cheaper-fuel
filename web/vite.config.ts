import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const TILE_CACHE = {
  expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
  cacheableResponse: { statuses: [0, 200] },
};

export default defineConfig({
  root: webRoot,
  base: "/",
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "maskable-512.png"],
      manifest: {
        name: "cheaper-fuel — preços de combustível",
        short_name: "cheaper-fuel",
        description: "Preços de combustível e descontos nos postos de Portugal continental.",
        lang: "pt-PT",
        theme_color: "#0b0f14",
        background_color: "#0b0f14",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/, /^\/health/, /^\/docs/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "cheaper-fuel-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/[a-z0-9-]*\.?basemaps\.cartocdn\.com\//i,
            handler: "CacheFirst",
            options: { cacheName: "cheaper-fuel-tiles", ...TILE_CACHE },
          },
          {
            urlPattern: /^https:\/\/[a-z]\.tile\.openstreetmap\.org\//i,
            handler: "CacheFirst",
            options: { cacheName: "cheaper-fuel-osm", ...TILE_CACHE },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@contracts": fileURLToPath(new URL("../shared/contracts.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/mcp": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});

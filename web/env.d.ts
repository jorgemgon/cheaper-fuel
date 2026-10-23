/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Tile URL template, e.g. https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png */
  readonly VITE_TILE_URL?: string;
  /** Attribution HTML shown on the map. */
  readonly VITE_TILE_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

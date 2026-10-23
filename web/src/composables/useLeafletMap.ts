import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { onBeforeUnmount, ref, type Ref } from "vue";

export interface MapPoint {
  id: number;
  latitude: number;
  longitude: number;
  color: string;
  popupHtml: string;
}

export interface LatLonPoint {
  latitude: number;
  longitude: number;
}

export interface MapHandlers {
  /** Map click or pin drop: the user picked a search point. */
  onPick?: (point: LatLonPoint) => void;
}

// OSM standard tiles need no API key. They are light by default, so the map
// pane is inverted with CSS (see .leaflet-tile in styles.css) to match the app.
// Set VITE_TILE_URL to use a keyed dark provider (CARTO, Stadia, MapTiler, ...).
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

const PIN_SVG = `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M14 1.5c6.9 0 12.5 5.5 12.5 12.3 0 8.9-12.5 20.7-12.5 20.7S1.5 22.7 1.5 13.8C1.5 7 7.1 1.5 14 1.5Z"
        fill="#6cc4ff" stroke="#0b1118" stroke-width="2"/>
  <circle cx="14" cy="13.5" r="4.5" fill="#0b1118"/>
</svg>`;

export function useLeafletMap(container: Ref<HTMLElement | null>, handlers: MapHandlers = {}) {
  let map: L.Map | null = null;
  let cluster: ReturnType<typeof L.markerClusterGroup> | null = null;
  let pin: L.Marker | null = null;
  const tileFailed = ref(false);

  function init(): void {
    if (map || !container.value) return;

    map = L.map(container.value, {
      center: [39.6, -8.0],
      zoom: 6,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    });

    const tileUrl = import.meta.env.VITE_TILE_URL ?? DEFAULT_TILE_URL;
    const attribution = import.meta.env.VITE_TILE_ATTRIBUTION ?? DEFAULT_ATTRIBUTION;

    const tiles = L.tileLayer(tileUrl, {
      attribution,
      maxZoom: 19,
      detectRetina: true,
    });

    tiles.on("tileerror", () => {
      tileFailed.value = true;
    });
    tiles.on("load", () => {
      tileFailed.value = false;
    });
    tiles.addTo(map);

    cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });
    map.addLayer(cluster);

    map.on("click", (event: L.LeafletMouseEvent) => {
      handlers.onPick?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
  }

  function setStations(points: readonly MapPoint[], fit = true): void {
    if (!map || !cluster) return;
    cluster.clearLayers();

    const markers = points.map((point) => {
      const icon = L.divIcon({
        className: "station-marker",
        html: `<span style="background:${point.color}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      return L.marker([point.latitude, point.longitude], { icon })
        .bindPopup(point.popupHtml, { maxWidth: 300, closeButton: true });
    });

    cluster.addLayers(markers);

    if (fit && markers.length > 0) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.18), { maxZoom: 14 });
    }
  }

  /** The search pin: dragged (or dropped by a map click) to choose a place. */
  function setPin(point: LatLonPoint | null): void {
    if (!map) return;
    if (!point) {
      pin?.remove();
      pin = null;
      return;
    }

    if (!pin) {
      const icon = L.divIcon({
        className: "location-pin",
        html: PIN_SVG,
        iconSize: [28, 36],
        iconAnchor: [14, 34],
      });
      pin = L.marker([point.latitude, point.longitude], {
        icon,
        draggable: true,
        autoPan: true,
        zIndexOffset: 1000,
      })
        .on("dragend", () => {
          const latlng = pin?.getLatLng();
          if (latlng) handlers.onPick?.({ latitude: latlng.lat, longitude: latlng.lng });
        })
        .addTo(map);
      return;
    }

    pin.setLatLng([point.latitude, point.longitude]);
  }

  function invalidate(): void {
    map?.invalidateSize();
  }

  function destroy(): void {
    map?.remove();
    map = null;
    cluster = null;
    pin = null;
  }

  onBeforeUnmount(destroy);

  return { init, setStations, setPin, invalidate, destroy, tileFailed };
}

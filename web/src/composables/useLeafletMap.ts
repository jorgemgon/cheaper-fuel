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

const DEFAULT_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
  '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

export function useLeafletMap(container: Ref<HTMLElement | null>) {
  let map: L.Map | null = null;
  let cluster: ReturnType<typeof L.markerClusterGroup> | null = null;
  let userMarker: L.CircleMarker | null = null;
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
      subdomains: "abcd",
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

  function setUser(latitude: number, longitude: number): void {
    if (!map) return;
    if (userMarker) userMarker.remove();

    userMarker = L.circleMarker([latitude, longitude], {
      radius: 8,
      color: "#6cc4ff",
      weight: 2,
      fillColor: "#6cc4ff",
      fillOpacity: 0.35,
    })
      .addTo(map)
      .bindPopup("A tua localização");

    map.setView([latitude, longitude], 13);
  }

  function invalidate(): void {
    map?.invalidateSize();
  }

  function destroy(): void {
    map?.remove();
    map = null;
    cluster = null;
    userMarker = null;
  }

  onBeforeUnmount(destroy);

  return { init, setStations, setUser, invalidate, destroy, tileFailed };
}

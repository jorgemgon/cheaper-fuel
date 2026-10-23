import { ref } from "vue";

export type GeoStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported";

export interface GeoCoords {
  latitude: number;
  longitude: number;
}

export function useGeolocation() {
  const status = ref<GeoStatus>("idle");
  const coords = ref<GeoCoords | null>(null);
  const message = ref<string | null>(null);

  async function locate(): Promise<GeoCoords | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      status.value = "unsupported";
      message.value = "Este navegador não suporta geolocalização. Escreve um concelho ou código postal.";
      return null;
    }

    if (typeof window !== "undefined" && window.isSecureContext === false) {
      status.value = "unavailable";
      message.value = "A localização só está disponível em ligações seguras (HTTPS).";
      return null;
    }

    status.value = "requesting";
    message.value = null;

    return new Promise<GeoCoords | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          coords.value = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          status.value = "granted";
          resolve(coords.value);
        },
        (error) => {
          switch (error.code) {
            case error.PERMISSION_DENIED:
              status.value = "denied";
              message.value =
                "Sem permissão de localização. Podes escrever um concelho ou código postal para procurar.";
              break;
            case error.POSITION_UNAVAILABLE:
              status.value = "unavailable";
              message.value = "Não foi possível obter a tua posição. Tenta escrever um local.";
              break;
            case error.TIMEOUT:
              status.value = "timeout";
              message.value = "A localização demorou demasiado tempo. Tenta novamente ou escreve um local.";
              break;
            default:
              status.value = "unavailable";
              message.value = "Não foi possível obter a tua posição.";
          }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 120_000 },
      );
    });
  }

  function setCoords(value: GeoCoords | null) {
    coords.value = value;
    if (value) status.value = "granted";
  }

  return { status, coords, message, locate, setCoords };
}

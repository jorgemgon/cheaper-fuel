import { onBeforeUnmount, onMounted, ref } from "vue";

export type LayoutMode = "mobile" | "small" | "big";

const BIG_QUERY = "(min-width: 1280px)";
const SMALL_QUERY = "(min-width: 900px)";

function readMode(): LayoutMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "mobile";
  if (window.matchMedia(BIG_QUERY).matches) return "big";
  if (window.matchMedia(SMALL_QUERY).matches) return "small";
  return "mobile";
}

/**
 * Three deliberate layouts: big desktop (three panes), small desktop (two
 * panes) and mobile (drawer + fuel carousel).
 */
export function useLayoutMode() {
  const mode = ref<LayoutMode>(readMode());
  let big: MediaQueryList | null = null;
  let small: MediaQueryList | null = null;

  const update = (): void => {
    mode.value = readMode();
  };

  onMounted(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    big = window.matchMedia(BIG_QUERY);
    small = window.matchMedia(SMALL_QUERY);
    big.addEventListener("change", update);
    small.addEventListener("change", update);
    update();
  });

  onBeforeUnmount(() => {
    big?.removeEventListener("change", update);
    small?.removeEventListener("change", update);
  });

  return mode;
}

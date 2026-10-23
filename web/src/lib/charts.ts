import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";

Chart.register(
  LineController,
  BarController,
  LineElement,
  PointElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
);

Chart.defaults.color = "#8aa1b6";
Chart.defaults.borderColor = "rgba(34, 48, 61, 0.8)";
Chart.defaults.font.family =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const CHART_TOOLTIP = {
  backgroundColor: "#16202b",
  borderColor: "#22303d",
  borderWidth: 1,
  titleColor: "#d8e2ec",
  bodyColor: "#d8e2ec",
  padding: 10,
} as const;

export const AXIS_COLOR = "#8aa1b6";

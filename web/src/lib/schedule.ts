import type { DiscountScheduleInfo } from "@contracts";

const WEEKDAY_SHORT = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WEEKDAY_LONG = [
  "",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
  "domingo",
];
const ORDINAL = ["", "Primeira", "Segunda", "Terceira", "Quarta", "Quinta"];

/** Portuguese label for a discount weekday/day-of-month schedule. */
export function formatSchedulePt(schedule: DiscountScheduleInfo): string {
  switch (schedule.kind) {
    case "weekdays":
      if (schedule.weekdays.length === 0) return "Todos os dias";
      return schedule.weekdays
        .map((day) => WEEKDAY_SHORT[day] ?? String(day))
        .join(", ");
    case "day_of_month":
      if (schedule.daysOfMonth.length === 0) return "Todos os dias";
      return `Dia ${schedule.daysOfMonth.join(", ")} de cada mês`;
    case "nth_weekday_of_month": {
      const ordinal = ORDINAL[schedule.nth ?? 0] ?? String(schedule.nth);
      const weekday = WEEKDAY_LONG[schedule.weekday ?? 0] ?? String(schedule.weekday);
      return `${ordinal} ${weekday} de cada mês`;
    }
    case "always":
    default:
      return "Todos os dias";
  }
}

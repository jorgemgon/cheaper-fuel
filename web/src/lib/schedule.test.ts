import { describe, expect, it } from "vitest";

import { formatSchedulePt } from "./schedule";

const base = {
  weekdays: [] as number[],
  daysOfMonth: [] as number[],
  nth: null as number | null,
  weekday: null as number | null,
};

describe("formatSchedulePt", () => {
  it("formats always schedules", () => {
    expect(formatSchedulePt({ ...base, kind: "always" })).toBe("Todos os dias");
  });

  it("formats weekday schedules with short Portuguese names", () => {
    expect(formatSchedulePt({ ...base, kind: "weekdays", weekdays: [1, 3, 5] })).toBe(
      "Seg, Qua, Sex",
    );
  });

  it("formats day-of-month schedules", () => {
    expect(formatSchedulePt({ ...base, kind: "day_of_month", daysOfMonth: [1, 15] })).toBe(
      "Dia 1, 15 de cada mês",
    );
  });

  it("formats nth-weekday schedules", () => {
    expect(
      formatSchedulePt({
        ...base,
        kind: "nth_weekday_of_month",
        nth: 1,
        weekday: 3,
      }),
    ).toBe("Primeira quarta-feira de cada mês");
  });

  it("falls back to every day for empty schedules", () => {
    expect(formatSchedulePt({ ...base, kind: "weekdays" })).toBe("Todos os dias");
    expect(formatSchedulePt({ ...base, kind: "day_of_month" })).toBe("Todos os dias");
  });
});

export interface FilterSummaryInput {
  fuels: readonly string[];
  cards: readonly string[];
  services: readonly string[];
  radiusKm: number;
}

/** One-line summary of the active filters, for the mobile/small drawer. */
export function describeFilters(input: FilterSummaryInput): string {
  const parts: string[] = [];

  if (input.fuels.length === 0) parts.push("todos os combustíveis");
  else if (input.fuels.length === 1) parts.push(input.fuels[0]);
  else parts.push(`${input.fuels.length} combustíveis`);

  if (input.cards.length > 0) {
    parts.push(`${input.cards.length} ${input.cards.length === 1 ? "cartão" : "cartões"}`);
  }
  if (input.services.length > 0) {
    parts.push(`${input.services.length} ${input.services.length === 1 ? "serviço" : "serviços"}`);
  }
  parts.push(`raio ${input.radiusKm} km`);

  return parts.join(" · ");
}

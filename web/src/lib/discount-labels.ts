import type { DiscountProgrammeInfo } from "@contracts";

const LABELS: Record<string, string> = {
  continente_card: "Cartão Continente",
  mundo_galp_app: "App Mundo Galp",
  galp_energy: "Galp energia",
  nos_package: "Pacote NOS",
  repsol_partner_card: "Cartão parceiro Repsol",
  repsol_electricity: "Repsol eletricidade",
  repsol_gas: "Repsol gás",
  poupa_mais_card: "Cartão Poupa Mais",
  lidl_plus: "App Lidl Plus",
  my_repsol: "My Repsol",
  intermarche_card: "Cartão Intermarché",
  "spend:continente_30": "30 € no Continente",
  "spend:pingodoce_40": "40 € no Pingo Doce",
  "spend:fuel_50": "50 € em combustível",
  "spend:repsol_fuel_30": "30 € em combustível",
};

const SERVICE_KEYS = new Set(["galp_energy", "nos_package", "repsol_electricity", "repsol_gas"]);

const FALLBACK_KEYS = [
  "continente_card",
  "mundo_galp_app",
  "repsol_partner_card",
  "poupa_mais_card",
  "lidl_plus",
  "my_repsol",
  "intermarche_card",
  "galp_energy",
  "repsol_electricity",
  "repsol_gas",
  "nos_package",
];

export function humanizeKey(key: string): string {
  return key
    .replace(/^spend:/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

export function labelForRequirement(key: string): string {
  return LABELS[key] ?? humanizeKey(key);
}

export interface ProfileOption {
  key: string;
  label: string;
  group: "card" | "service";
}

/** Every card/app and service key, used to start with everything selected. */
export function allProfileKeys(options: readonly ProfileOption[]): {
  cards: string[];
  services: string[];
} {
  return {
    cards: options.filter((option) => option.group === "card").map((option) => option.key),
    services: options.filter((option) => option.group === "service").map((option) => option.key),
  };
}

/** Builds the checkbox options from whatever the registry actually requires. */
export function buildProfileOptions(programmes: readonly DiscountProgrammeInfo[]): ProfileOption[] {
  const found = new Map<string, ProfileOption>();

  const add = (key: string) => {
    if (!key || key.startsWith("spend:") || found.has(key)) return;
    found.set(key, {
      key,
      label: labelForRequirement(key),
      group: SERVICE_KEYS.has(key) ? "service" : "card",
    });
  };

  for (const programme of programmes) {
    for (const discount of programme.discounts) {
      for (const requirement of discount.requires) add(requirement);
    }
  }
  for (const key of FALLBACK_KEYS) add(key);

  return [...found.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label, "pt"),
  );
}

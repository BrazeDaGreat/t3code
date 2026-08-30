import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities, normalizeModelSlug } from "@t3tools/shared/model";

type AntigravityEffort = "low" | "medium" | "high";

interface AntigravityModelFamily {
  readonly slug: string;
  readonly name: string;
  readonly efforts: ReadonlyArray<AntigravityEffort>;
}

const PROVIDER = ProviderDriverKind.make("antigravity");
const MODEL_FAMILIES: ReadonlyArray<AntigravityModelFamily> = [
  { slug: "gemini-3.7-flash", name: "Gemini 3.7 Flash", efforts: ["low", "medium", "high"] },
  { slug: "gemini-3.6-flash", name: "Gemini 3.6 Flash", efforts: ["low", "medium", "high"] },
  { slug: "gemini-3.5-flash", name: "Gemini 3.5 Flash", efforts: ["low", "medium", "high"] },
  { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro", efforts: ["low", "high"] },
];

function effortLabel(effort: AntigravityEffort): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function familyCapabilities(family: AntigravityModelFamily, defaultEffort: AntigravityEffort) {
  return createModelCapabilities({
    optionDescriptors: [
      {
        id: "effort",
        label: "Effort",
        type: "select",
        currentValue: defaultEffort,
        options: family.efforts.map((effort) => ({
          id: effort,
          label: effortLabel(effort),
          isDefault: effort === defaultEffort,
        })),
      },
    ],
  });
}

export const ANTIGRAVITY_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  ...MODEL_FAMILIES.map((family) => ({
    slug: family.slug,
    name: family.name,
    isCustom: false,
    capabilities: familyCapabilities(family, "high"),
  })),
  ...[
    { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
    { slug: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ].map((model) => ({
    ...model,
    isCustom: false,
    capabilities: createModelCapabilities({ optionDescriptors: [] }),
  })),
  // Keep stored selections readable without changing the effort they originally chose.
  ...MODEL_FAMILIES.flatMap((family) =>
    family.efforts.map((effort) => ({
      slug: `${family.slug}-${effort}`,
      name: `${family.name} (${effortLabel(effort)})`,
      isCustom: false,
      isLegacy: true,
      capabilities: familyCapabilities(family, effort),
    })),
  ),
];

/** Resolve T3's effort option to the exact native model ID supported by the CLI. */
export function resolveAntigravityModelSelection(
  requestedModel: string | null | undefined,
  requestedEffort?: string,
) {
  const model =
    normalizeModelSlug(requestedModel, PROVIDER) ??
    DEFAULT_MODEL_BY_PROVIDER[PROVIDER] ??
    "gemini-3.7-flash";
  const family = MODEL_FAMILIES.find(
    (candidate) =>
      candidate.slug === model ||
      candidate.efforts.some((effort) => `${candidate.slug}-${effort}` === model),
  );
  if (!family) {
    return { model, cliModel: model, effort: undefined };
  }

  const legacyEffort = family.efforts.find((effort) => `${family.slug}-${effort}` === model);
  const effort =
    family.efforts.find((candidate) => candidate === requestedEffort) ?? legacyEffort ?? "high";
  return { model, cliModel: `${family.slug}-${effort}`, effort };
}

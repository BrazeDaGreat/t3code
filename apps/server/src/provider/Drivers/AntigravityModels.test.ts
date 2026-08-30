import { describe, expect, it } from "vite-plus/test";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import {
  ANTIGRAVITY_BUILT_IN_MODELS,
  resolveAntigravityModelSelection,
} from "./AntigravityModels.ts";

describe("Antigravity effort selection", () => {
  it("groups Gemini families and advertises only supported effort levels", () => {
    const currentModels = ANTIGRAVITY_BUILT_IN_MODELS.filter((model) => !model.isLegacy);
    expect(
      currentModels.filter((model) => model.slug.startsWith("gemini-")).map((model) => model.slug),
    ).toEqual(["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro"]);
    const flash = currentModels.find((model) => model.slug === "gemini-3.7-flash");
    const pro = currentModels.find((model) => model.slug === "gemini-3.1-pro");
    expect(flash?.capabilities?.optionDescriptors).toMatchObject([
      {
        id: "effort",
        currentValue: "high",
        options: [{ id: "low" }, { id: "medium" }, { id: "high", isDefault: true }],
      },
    ]);
    expect(pro?.capabilities?.optionDescriptors).toMatchObject([
      { id: "effort", options: [{ id: "low" }, { id: "high" }] },
    ]);
  });

  it.each([
    { model: "gemini-3.7-flash", effort: "low", expected: "gemini-3.7-flash-low" },
    { model: "gemini-3.7-flash", effort: "medium", expected: "gemini-3.7-flash-medium" },
    { model: "gemini-3.7-flash", effort: "high", expected: "gemini-3.7-flash-high" },
    { model: "gemini-3.6-flash", effort: "medium", expected: "gemini-3.6-flash-medium" },
    { model: "gemini-3.5-flash", effort: "low", expected: "gemini-3.5-flash-low" },
    { model: "gemini-3.1-pro", effort: "low", expected: "gemini-3.1-pro-low" },
    { model: "gemini-3.1-pro", effort: "medium", expected: "gemini-3.1-pro-high" },
    { model: "flash", effort: "low", expected: "gemini-3.7-flash-low" },
    { model: "gemini-3.7-flash-low", effort: undefined, expected: "gemini-3.7-flash-low" },
    { model: "gemini-3.7-flash-low", effort: "high", expected: "gemini-3.7-flash-high" },
    { model: "gemini-3.7-flash", effort: undefined, expected: "gemini-3.7-flash-high" },
    { model: "custom-model-high", effort: "low", expected: "custom-model-high" },
    { model: "claude-opus-4-6-thinking", effort: "low", expected: "claude-opus-4-6-thinking" },
  ])("resolves $model with effort $effort to $expected", ({ model, effort, expected }) => {
    expect(resolveAntigravityModelSelection(model, effort).cliModel).toBe(expected);
  });

  it("preserves the effort of existing suffixed selections in T3's selector", () => {
    const legacy = ANTIGRAVITY_BUILT_IN_MODELS.find(
      (model) => model.slug === "gemini-3.7-flash-low",
    );
    expect(legacy?.isLegacy).toBe(true);
    expect(getProviderOptionDescriptors({ caps: legacy!.capabilities! })).toMatchObject([
      { id: "effort", currentValue: "low" },
    ]);
    expect(
      getProviderOptionDescriptors({
        caps: legacy!.capabilities!,
        selections: [{ id: "effort", value: "medium" }],
      }),
    ).toMatchObject([{ id: "effort", currentValue: "medium" }]);
  });

  it("does not advertise unverified effort options for fixed or custom models", () => {
    const claude = ANTIGRAVITY_BUILT_IN_MODELS.find((model) => model.slug === "claude-sonnet-4-6");
    expect(claude?.capabilities?.optionDescriptors).toEqual([]);
    expect(resolveAntigravityModelSelection("custom-model-high", "low").effort).toBeUndefined();
  });
});

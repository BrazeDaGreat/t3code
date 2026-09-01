import { EnvironmentId, type ProjectSkillSearchResult } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";
import {
  createSkillCatalogAtomFamily,
  mergeSkillCatalog,
  selectSkillCatalogResults,
} from "./skillCatalog.ts";

function skill(name: string, installs = 1, source = "owner/repo"): ProjectSkillSearchResult {
  return { name, source, installs };
}

describe("skill catalog", () => {
  it("starts empty and keeps fetched metadata separate per environment", () => {
    const catalog = createSkillCatalogAtomFamily();
    const registry = AtomRegistry.make();
    try {
      const first = catalog(EnvironmentId.make("first"));
      const second = catalog(EnvironmentId.make("second"));
      expect(registry.get(first)).toEqual([]);
      registry.set(first, [skill("react")]);
      expect(registry.get(catalog(EnvironmentId.make("first")))).toEqual([skill("react")]);
      expect(registry.get(second)).toEqual([]);
    } finally {
      registry.dispose();
    }
  });

  it("updates metadata without duplicating skills or merging different publishers", () => {
    const existing = [skill("react", 10), skill("testing")];
    expect(
      mergeSkillCatalog(existing, [skill("react", 20), skill("react", 5, "other/repo")]),
    ).toEqual([skill("testing"), skill("react", 20), skill("react", 5, "other/repo")]);
    expect(mergeSkillCatalog(existing, existing)).toBe(existing);
    expect(mergeSkillCatalog(existing, [])).toBe(existing);
  });

  it("bounds the growing catalog and preserves newly discovered skills", () => {
    const initial = Array.from({ length: 200 }, (_, index) => skill(`old-${index}`));
    const merged = mergeSkillCatalog(initial, [skill("new"), skill("old-0", 100)]);
    expect(merged).toHaveLength(200);
    expect(merged.some((entry) => entry.name === "old-1")).toBe(false);
    expect(merged.slice(-2)).toEqual([skill("new"), skill("old-0", 100)]);
  });

  it("shows a small starter selection and limits search results", () => {
    const catalog = Array.from({ length: 30 }, (_, index) => skill(`react-${index}`, index));
    expect(selectSkillCatalogResults(catalog, "")).toHaveLength(8);
    expect(selectSkillCatalogResults(catalog, "react")).toHaveLength(20);
    expect(selectSkillCatalogResults(catalog, "")[0]?.name).toBe("react-29");
  });

  it("keeps local matches usable while a search is pending or fails", () => {
    const catalog = [
      skill("react-testing", 10),
      skill("design"),
      skill("react-native", 20, "mobile/tools"),
    ];
    expect(selectSkillCatalogResults(catalog, " REACT mobile ")).toEqual([
      skill("react-native", 20, "mobile/tools"),
    ]);
    expect(selectSkillCatalogResults(catalog, "react")).toHaveLength(2);
    expect(selectSkillCatalogResults(catalog, "unknown")).toEqual([]);
  });

  it("includes relevant remote matches even when they do not literally match the query", () => {
    const catalog = [skill("ui-patterns"), skill("unrelated")];
    expect(selectSkillCatalogResults(catalog, "ui", [skill("frontend-design", 50)])).toEqual([
      skill("frontend-design", 50),
      skill("ui-patterns"),
    ]);
  });
});

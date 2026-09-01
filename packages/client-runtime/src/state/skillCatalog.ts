import type { EnvironmentId, ProjectSkillSearchResult } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

type SkillCatalog = ReadonlyArray<ProjectSkillSearchResult>;

/** Keep recently discovered metadata without retaining an unbounded directory. */
export function mergeSkillCatalog(catalog: SkillCatalog, incoming: SkillCatalog): SkillCatalog {
  if (incoming.length === 0) return catalog;
  const entries = new Map(catalog.map((skill) => [`${skill.source}/${skill.name}`, skill]));
  let changed = false;
  for (const skill of incoming) {
    const key = `${skill.source}/${skill.name}`;
    if (entries.get(key) === skill) continue;
    changed = true;
    entries.delete(key);
    entries.set(key, skill);
  }
  return changed ? [...entries.values()].slice(-200) : catalog;
}

/** Combine immediate local matches with the current query's remote results. */
export function selectSkillCatalogResults(
  catalog: SkillCatalog,
  query: string,
  remote: SkillCatalog = [],
): SkillCatalog {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = catalog.filter((skill) => {
    const text = `${skill.name} ${skill.source}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  return [...mergeSkillCatalog(matches, remote)]
    .sort((a, b) => b.installs - a.installs || a.name.localeCompare(b.name))
    .slice(0, terms.length === 0 ? 8 : 20);
}

export function createSkillCatalogAtomFamily() {
  return Atom.family((environmentId: EnvironmentId) =>
    Atom.make<SkillCatalog>([]).pipe(
      Atom.setIdleTTL("30 minutes"),
      Atom.withLabel(`environment-data:projects:skills:catalog:${environmentId}`),
    ),
  );
}

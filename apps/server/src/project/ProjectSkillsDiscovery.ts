import { ProjectSkillsError, type ProjectInstalledSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { readSkillDescription } from "./ProjectSkillDescription.ts";

const decodeLock = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      skills: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
);
const decodeSource = Schema.decodeUnknownOption(Schema.Struct({ source: Schema.String }));

export function projectSkillKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Lists project skill files and bounded description metadata without running the CLI. */
export const readProjectSkills = Effect.fn("readProjectSkills")(
  function* (cwd: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(cwd);
    const lockText = yield* fs
      .readFileString(path.join(root, "skills-lock.json"))
      .pipe(Effect.orElseSucceed(() => ""));
    // Provenance is optional. A missing or damaged lockfile must not hide files.
    const lock = decodeLock(lockText);
    const sources = new Map<string, string>();
    if (Option.isSome(lock)) {
      for (const [name, entry] of Object.entries(lock.value.skills)) {
        const source = decodeSource(entry);
        if (Option.isSome(source)) sources.set(projectSkillKey(name), source.value.source);
      }
    }

    const directories = yield* Effect.forEach(
      [".agents", ".claude"] as const,
      (agent) =>
        Effect.gen(function* () {
          const directory = path.join(root, agent, "skills");
          const entries = yield* fs.readDirectory(directory).pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "NotFound",
              () => Effect.succeed([]),
            ),
          );
          const skills = yield* Effect.forEach(
            entries,
            (name) =>
              Effect.gen(function* () {
                const skillDirectory = path.join(directory, name);
                const directoryInfo = yield* fs.stat(skillDirectory).pipe(
                  Effect.catchIf(
                    (error) => error.reason._tag === "NotFound",
                    () => Effect.succeed(null),
                  ),
                );
                if (directoryInfo?.type !== "Directory") return null;
                const skillFile = yield* fs.stat(path.join(skillDirectory, "SKILL.md")).pipe(
                  Effect.catchIf(
                    (error) => error.reason._tag === "NotFound",
                    () => Effect.succeed(null),
                  ),
                );
                if (skillFile?.type !== "File") return null;
                const description = yield* readSkillDescription(
                  path.join(skillDirectory, "SKILL.md"),
                );
                return { name, description };
              }),
            { concurrency: 8 },
          );
          return { agent, skills };
        }),
      { concurrency: 2 },
    );

    const installed = new Map<string, ProjectInstalledSkill>();
    for (const { agent, skills } of directories) {
      for (const skill of skills) {
        if (skill === null) continue;
        const { name } = skill;
        const previous = installed.get(name);
        const description = previous?.description ?? skill.description;
        installed.set(name, {
          name,
          ...(description ? { description } : {}),
          source: sources.get(projectSkillKey(name)) ?? null,
          agents: agent === ".agents" || previous?.agents === true,
          claude: agent === ".claude" || previous?.claude === true,
        });
      }
    }
    return [...installed.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
  Effect.mapError(
    (error) =>
      new ProjectSkillsError({
        message: `Could not read project skills: ${error.message}`,
      }),
  ),
);

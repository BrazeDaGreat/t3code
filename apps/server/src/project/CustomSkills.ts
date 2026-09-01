import {
  ProjectCustomSkillsInstallInput,
  ProjectSkillName,
  ProjectSkillsError,
  type ProjectCustomSkillsListResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { expandHomePath } from "../pathExpansion.ts";
import { readSkillDescription } from "./ProjectSkillDescription.ts";
import { projectSkillKey, readProjectSkills } from "./ProjectSkillsDiscovery.ts";

const decodeName = Schema.decodeUnknownOption(ProjectSkillName);
const decodeInstall = Schema.decodeUnknownEffect(ProjectCustomSkillsInstallInput);
const LockJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeLock = Schema.decodeUnknownOption(LockJson);
const encodeLock = Schema.encodeSync(LockJson);
const decodeLockSkills = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const isSkillsError = Schema.is(ProjectSkillsError);

function containsPath(path: Path.Path, root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

const resolveLibrary = Effect.fn("CustomSkills.resolveLibrary")(function* (configuredPath: string) {
  if (!configuredPath.trim()) return null;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const expanded = expandHomePath(configuredPath.trim());
  if (!path.isAbsolute(expanded)) {
    return yield* new ProjectSkillsError({
      message: "Custom Skills Path must be an absolute path or start with ~/ on this environment.",
    });
  }
  return yield* fs.realPath(expanded);
});

const customError = (error: { message: string }) =>
  isSkillsError(error)
    ? error
    : new ProjectSkillsError({
        message: `Could not access custom skills: ${error.message}`,
      });

/** Reads only immediate skill folders; descriptions use the same bounded reader as installed skills. */
export const listCustomSkills = Effect.fn("CustomSkills.list")(function* (configuredPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* resolveLibrary(configuredPath);
  if (root === null) return { path: null, skills: [] } satisfies ProjectCustomSkillsListResult;
  const entries = yield* fs.readDirectory(root);
  const skills = yield* Effect.forEach(
    entries,
    (name) =>
      Effect.gen(function* () {
        if (Option.isNone(decodeName(name))) return null;
        const directory = path.join(root, name);
        // A custom library owns its skill folders; do not expose linked external folders.
        if (Option.isSome(yield* fs.readLink(directory).pipe(Effect.option))) return null;
        const info = yield* fs.stat(directory);
        if (info.type !== "Directory") return null;
        const file = path.join(directory, "SKILL.md");
        const skillInfo = yield* fs.stat(file).pipe(
          Effect.catchIf(
            (error) => error.reason._tag === "NotFound",
            () => Effect.succeed(null),
          ),
        );
        if (skillInfo?.type !== "File") return null;
        const description = yield* readSkillDescription(file);
        return { name, ...(description ? { description } : {}) };
      }),
    { concurrency: 8 },
  );
  return {
    path: root,
    skills: skills.filter((skill) => skill !== null).sort((a, b) => a.name.localeCompare(b.name)),
  };
}, Effect.mapError(customError));

/** Copies a library skill into both project roots, without CLI/network access or overwriting files. */
export const installCustomSkill = Effect.fn("CustomSkills.install")(function* (
  configuredPath: string,
  rawInput: ProjectCustomSkillsInstallInput,
) {
  const input = yield* decodeInstall(rawInput).pipe(
    Effect.mapError(() => new ProjectSkillsError({ message: "Invalid custom skill selection." })),
  );
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const library = yield* resolveLibrary(configuredPath);
  if (library === null || path.relative(library, input.sourcePath) !== "") {
    return yield* new ProjectSkillsError({
      message: "Custom Skills Path changed. Refresh the Custom tab and select the skill again.",
    });
  }
  const source = path.join(library, input.name);
  const root = yield* fs.realPath(input.cwd);
  if (containsPath(path, source, root)) {
    return yield* new ProjectSkillsError({
      message: "The project cannot be inside the custom skill being installed.",
    });
  }
  const installed = yield* readProjectSkills(root);
  if (installed.some((skill) => projectSkillKey(skill.name) === projectSkillKey(input.name))) {
    return yield* new ProjectSkillsError({
      message:
        "A skill with this name is already in the project. Remove it from Installed before adding this copy.",
    });
  }
  if ((yield* fs.stat(path.join(source, "SKILL.md"))).type !== "File") {
    return yield* new ProjectSkillsError({
      message: "This custom skill must contain a SKILL.md file.",
    });
  }

  // Copy plain files and directories only. Linked files can depend on paths outside the library.
  const validateTree = Effect.fn("CustomSkills.validateTree")(function* (
    entry: string,
  ): Effect.fn.Return<void, ProjectSkillsError | PlatformError.PlatformError> {
    if (Option.isSome(yield* fs.readLink(entry).pipe(Effect.option))) {
      return yield* new ProjectSkillsError({
        message: "Custom skills must contain regular files and folders, without symbolic links.",
      });
    }
    const info = yield* fs.stat(entry);
    if (info.type === "Directory") {
      for (const child of yield* fs.readDirectory(entry))
        yield* validateTree(path.join(entry, child));
    } else if (info.type !== "File") {
      return yield* new ProjectSkillsError({
        message: "Custom skills must contain regular files and folders.",
      });
    }
  });
  yield* validateTree(source);

  const destinations: string[] = [];
  for (const agent of [".agents", ".claude"]) {
    let parent = root;
    for (const segment of [agent, "skills"]) {
      const next = path.join(parent, segment);
      if (!(yield* fs.exists(next))) yield* fs.makeDirectory(next);
      parent = yield* fs.realPath(next);
      if (containsPath(path, source, parent)) {
        return yield* new ProjectSkillsError({
          message: "Project skill folders cannot point into the custom skill's source folder.",
        });
      }
      if (!containsPath(path, root, parent)) {
        return yield* new ProjectSkillsError({
          message: "Project skill folders must stay inside the project directory.",
        });
      }
    }
    const destination = path.join(parent, input.name);
    if (
      (yield* fs.readDirectory(parent)).some(
        (name) => projectSkillKey(name) === projectSkillKey(input.name),
      )
    ) {
      return yield* new ProjectSkillsError({
        message:
          "A folder with this skill's name already exists. Remove the existing copy before installing.",
      });
    }
    destinations.push(destination);
  }

  const created: string[] = [];
  yield* Effect.gen(function* () {
    for (const destination of destinations) {
      // Exclusive mkdir catches concurrent installs and dangling links before copying.
      yield* fs.makeDirectory(destination);
      created.push(destination);
    }
    for (const destination of destinations) yield* fs.copy(source, destination);
    // A manually deleted remote skill can leave provenance behind. Its replacement is local.
    const lockPath = path.join(root, "skills-lock.json");
    const lockText = yield* fs.readFileString(lockPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
    const lock = decodeLock(lockText);
    if (Option.isSome(lock)) {
      const lockSkills = decodeLockSkills(lock.value.skills);
      if (Option.isSome(lockSkills)) {
        const entries = Object.entries(lockSkills.value);
        const remaining = entries.filter(
          ([name]) => projectSkillKey(name) !== projectSkillKey(input.name),
        );
        if (remaining.length !== entries.length) {
          if (Option.isSome(yield* fs.readLink(lockPath).pipe(Effect.option))) {
            return yield* new ProjectSkillsError({
              message:
                "Cannot update a linked skills-lock.json. Use a regular project lockfile before replacing a remote skill with a custom copy.",
            });
          }
          yield* fs.writeFileString(
            lockPath,
            encodeLock({ ...lock.value, skills: Object.fromEntries(remaining) }),
          );
        }
      }
    }
  }).pipe(
    Effect.onError(() =>
      Effect.forEach(
        created,
        (destination) =>
          Effect.gen(function* () {
            const actual = yield* fs.realPath(destination);
            if (containsPath(path, root, actual) && path.relative(destination, actual) === "") {
              yield* fs.remove(destination, { recursive: true });
            }
          }).pipe(Effect.ignore),
        { discard: true },
      ),
    ),
  );
  return yield* readProjectSkills(root);
}, Effect.mapError(customError));

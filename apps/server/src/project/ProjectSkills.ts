import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import {
  ProjectSkillsError,
  type ProjectCustomSkillsListResult,
  type ProjectCustomSkillsInstallInput,
  ProjectSkillsInstallInput,
  ProjectSkillsRemoveInput,
  ProjectSkillsDescribeInput,
  type ProjectSkillsDescribeResult,
  ProjectSkillsSearchResult,
  ProjectSkillSearchResult,
  type ProjectSkillsListInput,
  type ProjectSkillsListResult,
  type ProjectSkillsSearchInput,
} from "@t3tools/contracts";
import * as NodeUtil from "node:util";
import { ProcessRunner } from "../processRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { listCustomSkills, installCustomSkill } from "./CustomSkills.ts";
import { projectSkillKey, readProjectSkills } from "./ProjectSkillsDiscovery.ts";
import { parseSkillPageDescription } from "./ProjectSkillDescription.ts";

// Keep install/remove behavior stable across environments.
const SKILLS_PACKAGE = "skills@1.5.23";
const TARGET_AGENTS = ["--agent", "codex", "claude-code"];
// The directory includes hosted-domain sources as well as GitHub repositories.
// Decode rows separately so an unsupported source cannot hide installable skills.
const SearchResponse = Schema.Struct({ skills: Schema.Array(Schema.Unknown) });
const decodeSearchSkill = Schema.decodeUnknownOption(ProjectSkillSearchResult);
const decodeInstallInput = Schema.decodeUnknownEffect(ProjectSkillsInstallInput);
const decodeRemoveInput = Schema.decodeUnknownEffect(ProjectSkillsRemoveInput);
const decodeDescribeInput = Schema.decodeUnknownEffect(ProjectSkillsDescribeInput);
const decodeSearchResponse = HttpClientResponse.schemaBodyJson(SearchResponse);

export class ProjectSkills extends Context.Service<
  ProjectSkills,
  {
    readonly listCustom: () => Effect.Effect<ProjectCustomSkillsListResult, ProjectSkillsError>;
    readonly installCustom: (
      input: ProjectCustomSkillsInstallInput,
    ) => Effect.Effect<ProjectSkillsListResult, ProjectSkillsError>;
    readonly list: (
      input: ProjectSkillsListInput,
    ) => Effect.Effect<ProjectSkillsListResult, ProjectSkillsError>;
    readonly search: (
      input: ProjectSkillsSearchInput,
    ) => Effect.Effect<typeof ProjectSkillsSearchResult.Type, ProjectSkillsError>;
    readonly describe: (
      input: ProjectSkillsDescribeInput,
    ) => Effect.Effect<ProjectSkillsDescribeResult, ProjectSkillsError>;
    readonly install: (
      input: ProjectSkillsInstallInput,
    ) => Effect.Effect<ProjectSkillsListResult, ProjectSkillsError>;
    readonly remove: (
      input: ProjectSkillsRemoveInput,
    ) => Effect.Effect<ProjectSkillsListResult, ProjectSkillsError>;
  }
>()("t3/project/ProjectSkills") {}

export const layer = Layer.effect(
  ProjectSkills,
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const settings = yield* ServerSettingsService;
    const customPath = settings.getSettings.pipe(
      Effect.map((value) => value.customSkillsPath),
      Effect.mapError(
        () =>
          new ProjectSkillsError({
            message: "Could not read Custom Skills Path from environment settings.",
          }),
      ),
    );
    const readInstalled = (cwd: string) =>
      readProjectSkills(cwd).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    // Shared by every client. CLI writes update a project lockfile as well as skill files.
    const cliLock = yield* Semaphore.make(1);

    const run = Effect.fn("ProjectSkills.run")(function* (
      cwd: string,
      args: ReadonlyArray<string>,
    ) {
      const root = yield* fs
        .realPath(cwd)
        .pipe(
          Effect.mapError(
            () => new ProjectSkillsError({ message: "The project directory is unavailable." }),
          ),
        );
      const output = yield* processRunner
        .run({
          command: "npx",
          args: ["--yes", SKILLS_PACKAGE, ...args],
          cwd: root,
          stdin: "",
          env: {
            ...process.env,
            CI: "1",
            NO_COLOR: "1",
            DISABLE_TELEMETRY: "1",
            GIT_TERMINAL_PROMPT: "0",
          },
          timeout: "2 minutes",
          maxOutputBytes: 1_000_000,
          outputMode: "error",
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new ProjectSkillsError({
                message:
                  error._tag === "ProcessSpawnError"
                    ? "Could not start the skills CLI. Install Node.js 22.20+ and npm on this project's server, then retry."
                    : error._tag === "ProcessTimeoutError"
                      ? "The skills CLI timed out. Refresh installed skills before retrying."
                      : `Could not run the skills CLI: ${error.message}`,
              }),
          ),
        );
      if (output.code !== 0) {
        const detail = NodeUtil.stripVTControlCharacters(`${output.stderr}\n${output.stdout}`)
          .trim()
          .slice(-2000);
        return yield* new ProjectSkillsError({
          message: `The skills CLI failed.${detail ? `\n${detail}` : ""}`,
        });
      }
      return output.stdout;
    });

    const install = Effect.fn("ProjectSkills.install")(function* (
      input: ProjectSkillsInstallInput,
    ) {
      yield* decodeInstallInput(input).pipe(
        Effect.mapError(
          () =>
            new ProjectSkillsError({ message: "Choose a skill and its owner/repository source." }),
        ),
      );
      const previous = yield* readInstalled(input.cwd);
      const existing = previous.find(
        (skill) => projectSkillKey(skill.name) === projectSkillKey(input.name),
      );
      if (existing && existing.source !== input.source) {
        return yield* new ProjectSkillsError({
          message:
            "A skill with this name already exists from another source (or was added locally). Remove it before installing a replacement.",
        });
      }
      if (existing?.agents && existing.claude) return previous;
      yield* run(input.cwd, [
        "add",
        input.source,
        "--skill",
        input.name,
        ...TARGET_AGENTS,
        "--copy",
        "--yes",
      ]);
      const installed = yield* readInstalled(input.cwd);
      if (
        !installed.some(
          (skill) =>
            projectSkillKey(skill.name) === projectSkillKey(input.name) &&
            skill.agents &&
            skill.claude,
        )
      ) {
        return yield* new ProjectSkillsError({
          message:
            "The CLI finished, but the skill was not found in both .agents and .claude. Refresh installed skills to inspect the result.",
        });
      }
      return installed;
    });

    const remove = Effect.fn("ProjectSkills.remove")(function* (input: ProjectSkillsRemoveInput) {
      yield* decodeRemoveInput(input).pipe(
        Effect.mapError(() => new ProjectSkillsError({ message: "Invalid skill name." })),
      );
      // A canonical .agents skill is shared by several providers. The CLI otherwise
      // retains it when another installed provider still uses that directory.
      yield* run(input.cwd, ["remove", input.name, "--yes"]);
      const installed = yield* readInstalled(input.cwd);
      if (installed.some((skill) => projectSkillKey(skill.name) === projectSkillKey(input.name))) {
        return yield* new ProjectSkillsError({
          message: "The skill is still installed. Refresh and retry removing it.",
        });
      }
      return installed;
    });

    const search = Effect.fn("ProjectSkills.search")(
      function* (input: ProjectSkillsSearchInput) {
        // Use the same directory endpoint as `skills find`, without parsing terminal output.
        const url = new URL("https://skills.sh/api/search");
        const query = input.query.trim();
        const limit = query.length === 0 ? 8 : 20;
        url.searchParams.set("q", query || "agent");
        url.searchParams.set("limit", String(limit));
        const response = yield* http.get(url.toString());
        const result = yield* decodeSearchResponse(response).pipe(
          Effect.mapError(
            () =>
              new ProjectSkillsError({
                message: "skills.sh returned an unexpected search response. Please retry.",
              }),
          ),
        );
        return result.skills
          .flatMap((entry) => {
            const skill = decodeSearchSkill(entry);
            return Option.isSome(skill) ? [skill.value] : [];
          })
          .sort((a, b) => b.installs - a.installs)
          .slice(0, limit);
      },
      Effect.timeout("15 seconds"),
      Effect.mapError((error) => {
        if (error._tag === "ProjectSkillsError") return error;
        if (error._tag === "TimeoutError") {
          return new ProjectSkillsError({
            message: "Searching skills.sh timed out. Please retry.",
          });
        }
        if (error.reason._tag === "StatusCodeError") {
          return new ProjectSkillsError({
            message: `skills.sh returned HTTP ${error.reason.response.status}. Please retry.`,
          });
        }
        return new ProjectSkillsError({
          message: "Could not reach skills.sh. Check the server's internet connection and retry.",
        });
      }),
    );

    const describe = Effect.fn("ProjectSkills.describe")(
      function* (input: ProjectSkillsDescribeInput) {
        yield* decodeDescribeInput(input).pipe(
          Effect.mapError(
            () =>
              new ProjectSkillsError({
                message: "Invalid skill source or name.",
              }),
          ),
        );
        const source = input.source.split("/").map(encodeURIComponent).join("/");
        const slug = encodeURIComponent(projectSkillKey(input.name));
        const response = yield* http.get(`https://skills.sh/${source}/${slug}`);
        let size = 0;
        const decoder = new TextDecoder();
        const html = yield* response.stream.pipe(
          Stream.mapEffect((chunk) => {
            size += chunk.byteLength;
            return size > 2 * 1024 * 1024
              ? Effect.fail(
                  new ProjectSkillsError({
                    message: "The skill's description page is too large to preview.",
                  }),
                )
              : Effect.succeed(decoder.decode(chunk, { stream: true }));
          }),
          Stream.runFold(
            () => "",
            (text, chunk) => text + chunk,
          ),
        );
        return { description: parseSkillPageDescription(html + decoder.decode(), input.name) };
      },
      Effect.timeout("10 seconds"),
      Effect.mapError((error) => {
        if (error._tag === "ProjectSkillsError") return error;
        return new ProjectSkillsError({
          message:
            error._tag === "TimeoutError"
              ? "Loading the description timed out. Please retry."
              : "Could not load this skill's description. Please retry.",
        });
      }),
    );

    return ProjectSkills.of({
      listCustom: () =>
        customPath.pipe(
          Effect.flatMap(listCustomSkills),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
      installCustom: (input) =>
        cliLock.withPermits(1)(
          customPath.pipe(
            Effect.flatMap((configuredPath) => installCustomSkill(configuredPath, input)),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          ),
        ),
      list: (input) => readInstalled(input.cwd),
      search,
      describe,
      install: (input) => cliLock.withPermits(1)(install(input)),
      remove: (input) => cliLock.withPermits(1)(remove(input)),
    });
  }),
);

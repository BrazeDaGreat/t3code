import {
  type AntigravitySettings,
  type ModelCapabilities,
  type ServerProviderModel,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { discoverAntigravitySkills } from "../Drivers/AntigravitySkills.ts";
import { ANTIGRAVITY_BUILT_IN_MODELS } from "../Drivers/AntigravityModels.ts";

const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "Gemini",
  showInteractionModeToggle: false,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;

export function buildInitialAntigravityProviderSnapshot(
  antigravitySettings: AntigravitySettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = antigravityModelsFromSettings(antigravitySettings.customModels);

    if (!antigravitySettings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Antigravity availability...",
      },
    });
  });
}

function antigravityModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = ANTIGRAVITY_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(builtInModels, customModels ?? [], EMPTY_CAPABILITIES);
}

const runAntigravityVersionCommand = (
  antigravitySettings: AntigravitySettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const command = antigravitySettings.binaryPath || "agy";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (
    antigravitySettings: AntigravitySettings,
    environment: NodeJS.ProcessEnv = process.env,
    cwd?: string,
  ): Effect.fn.Return<
    ServerProviderDraft,
    never,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | FileSystem.FileSystem | Path.Path
  > {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const fallbackModels = antigravityModelsFromSettings(antigravitySettings.customModels);
    const binary = antigravitySettings.binaryPath || "agy";

    if (!antigravitySettings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in T3 Code settings.",
        },
      });
    }

    const skills: ReadonlyArray<ServerProviderSkill> = yield* discoverAntigravitySkills(cwd).pipe(
      Effect.orElseSucceed(() => []),
    );

    const versionResult = yield* runAntigravityVersionCommand(
      antigravitySettings,
      environment,
    ).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);

    if (Result.isFailure(versionResult)) {
      const error = versionResult.failure;
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: antigravitySettings.enabled,
        checkedAt,
        models: fallbackModels,
        skills,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Antigravity CLI (agy) is not installed or not on PATH."
            : "Failed to execute Antigravity CLI health check.",
        },
      });
    }

    if (Option.isNone(versionResult.success)) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: antigravitySettings.enabled,
        checkedAt,
        models: fallbackModels,
        skills,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: `Antigravity CLI is installed but timed out while running \`${binary} --version\`.`,
        },
      });
    }

    const versionOutput = versionResult.success.value;
    const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: antigravitySettings.enabled,
      checkedAt,
      models: fallbackModels,
      skills,
      probe: {
        installed: true,
        version: version ?? null,
        status: versionOutput.code === 0 ? "ready" : "error",
        auth: { status: versionOutput.code === 0 ? "authenticated" : "unknown" },
        message:
          versionOutput.code === 0
            ? "Antigravity is ready."
            : "Antigravity CLI is installed but failed to run.",
      },
    });
  },
);

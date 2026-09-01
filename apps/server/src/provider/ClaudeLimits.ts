import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import { ProviderLimitsError, type ClaudeSettings } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";
import { decodeClaudeLimits } from "./ProviderLimits.ts";

const Credentials = Schema.fromJsonString(
  Schema.Struct({
    claudeAiOauth: Schema.optional(Schema.Struct({ accessToken: Schema.String })),
  }),
);
const decodeCredentials = Schema.decodeUnknownEffect(Credentials);
const isLimitsError = Schema.is(ProviderLimitsError);

/** Mirrors Claude Code's per-config keychain namespace, including its explicit override. */
export function claudeCredentialService(environment: NodeJS.ProcessEnv, configDir: string): string {
  const storageDir =
    environment.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? (environment.CLAUDE_CONFIG_DIR ? configDir : "");
  const suffix = storageDir
    ? `-${NodeCrypto.createHash("sha256").update(storageDir.normalize("NFC")).digest("hex").slice(0, 8)}`
    : "";
  return `Claude Code-credentials${suffix}`;
}

/** Credentials stay in the environment and are sent only to Anthropic's usage endpoint. */
export const readClaudeLimits = Effect.fn("readClaudeLimits")(
  function* (config: ClaudeSettings, baseEnvironment: NodeJS.ProcessEnv) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const httpClient = yield* HttpClient.HttpClient;
    const environment = yield* makeClaudeEnvironment(config, baseEnvironment);
    const platform = yield* HostProcessPlatform;
    if (
      environment.ANTHROPIC_API_KEY ||
      environment.ANTHROPIC_AUTH_TOKEN ||
      environment.CLAUDE_CODE_USE_BEDROCK === "1" ||
      environment.CLAUDE_CODE_USE_VERTEX === "1" ||
      environment.CLAUDE_CODE_USE_FOUNDRY === "1"
    ) {
      return yield* new ProviderLimitsError({
        reason: "unsupported",
        detail: "Subscription limits are unavailable for API key or cloud-provider authentication.",
      });
    }
    let token = environment.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (!token) {
      const configDir = path.resolve(
        environment.CLAUDE_CONFIG_DIR || path.join(NodeOS.homedir(), ".claude"),
      );
      let raw: string | null = null;
      if (platform === "darwin") {
        raw = yield* spawner
          .string(
            ChildProcess.make("/usr/bin/security", [
              "find-generic-password",
              "-w",
              "-s",
              claudeCredentialService(environment, configDir),
            ]),
          )
          .pipe(
            Effect.timeout("5 seconds"),
            Effect.orElseSucceed(() => null),
          );
      }
      if (!raw) {
        raw = yield* fileSystem
          .readFileString(path.join(configDir, ".credentials.json"))
          .pipe(Effect.orElseSucceed(() => null));
      }
      if (raw) {
        const credentials = yield* decodeCredentials(raw).pipe(Effect.orElseSucceed(() => null));
        token = credentials?.claudeAiOauth?.accessToken.trim();
      }
    }
    if (!token) {
      return yield* new ProviderLimitsError({
        reason: "authentication",
        detail: "Sign in to this Claude instance with a Claude subscription to view its limits.",
      });
    }
    const response = yield* httpClient.get("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
    });
    if (response.status === 401 || response.status === 403) {
      return yield* new ProviderLimitsError({
        reason: "authentication",
        detail:
          "Claude sign-in expired or lacks permission to read usage. Sign in again in Claude Code, then refresh.",
      });
    }
    if (response.status === 429) {
      return yield* new ProviderLimitsError({
        reason: "requestFailed",
        detail: "Claude is limiting usage checks. Wait a moment before refreshing.",
      });
    }
    if (response.status !== 200) {
      return yield* new ProviderLimitsError({
        reason: "requestFailed",
        detail: "Claude could not report limits. Try refreshing again shortly.",
      });
    }
    return yield* decodeClaudeLimits(yield* response.json, DateTime.formatIso(yield* DateTime.now));
  },
  Effect.timeout("15 seconds"),
  Effect.mapError((error) =>
    isLimitsError(error)
      ? error
      : new ProviderLimitsError({
          reason: "requestFailed",
          detail: "Could not read Claude limits. Check your connection and refresh.",
        }),
  ),
);

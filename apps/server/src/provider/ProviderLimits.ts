import { ProviderLimits, ProviderLimitsError, type CodexSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { openCodexAccountClient } from "./Layers/CodexProvider.ts";
import { resolveCodexLaunchArgs } from "./Layers/codexLaunchArgs.ts";

const ClaudeWindow = Schema.Struct({
  utilization: Schema.Number,
  resets_at: Schema.NullOr(Schema.DateTimeUtcFromString),
});
const ClaudeUsage = Schema.Struct({
  five_hour: Schema.optional(Schema.NullOr(ClaudeWindow)),
  seven_day: Schema.optional(Schema.NullOr(ClaudeWindow)),
});

const decodeLimits = Schema.decodeUnknownEffect(ProviderLimits);
const decodeClaudeUsage = Schema.decodeUnknownEffect(ClaudeUsage);
const decodeResetAt = Schema.decodeUnknownEffect(Schema.DateTimeUtcFromMillis);
const isLimitsError = Schema.is(ProviderLimitsError);

export const decodeClaudeLimits = Effect.fn("decodeClaudeLimits")(function* (
  response: unknown,
  readAt: string,
) {
  const usage = yield* decodeClaudeUsage(response);
  if (!("five_hour" in usage) && !("seven_day" in usage)) {
    return yield* new ProviderLimitsError({
      reason: "unsupported",
      detail: "Claude did not report subscription limit windows for this account.",
    });
  }
  const window = (value: typeof ClaudeWindow.Type | null | undefined, minutes: number) =>
    value == null
      ? null
      : {
          usedPercent: value.utilization,
          resetsAt: value.resets_at === null ? null : DateTime.formatIso(value.resets_at),
          windowDurationMins: minutes,
        };
  return yield* decodeLimits({
    readAt,
    session: window(usage.five_hour, 300),
    weekly: window(usage.seven_day, 10_080),
  });
});

export const decodeCodexLimits = Effect.fn("decodeCodexLimits")(function* (
  response: CodexSchema.V2GetAccountRateLimitsResponse,
  readAt: string,
) {
  const limits = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  const window = Effect.fn("decodeCodexLimitWindow")(function* (
    value: CodexSchema.V2GetAccountRateLimitsResponse__RateLimitWindow | null | undefined,
  ) {
    if (value == null) return null;
    const resetsAt = value.resetsAt == null ? null : yield* decodeResetAt(value.resetsAt * 1000);
    return {
      usedPercent: value.usedPercent,
      resetsAt: resetsAt === null ? null : DateTime.formatIso(resetsAt),
      windowDurationMins: value.windowDurationMins ?? null,
    };
  });
  return yield* decodeLimits({
    readAt,
    session: yield* window(limits.primary),
    weekly: yield* window(limits.secondary),
  });
});

/** Opens a short-lived account client; no thread or model turn is created. */
export const readCodexLimits = Effect.fn("readCodexLimits")(
  function* (config: CodexSettings, environment: NodeJS.ProcessEnv) {
    const { client } = yield* openCodexAccountClient({
      binaryPath: config.binaryPath,
      homePath: config.homePath,
      launchArgs: resolveCodexLaunchArgs(config.launchArgs, environment),
      environment,
      cwd: process.cwd(),
    });
    const { account } = yield* client.request("account/read", {});
    if (!account) {
      return yield* new ProviderLimitsError({
        reason: "authentication",
        detail: "Sign in to this Codex instance to view its limits.",
      });
    }
    if (account.type !== "chatgpt") {
      return yield* new ProviderLimitsError({
        reason: "unsupported",
        detail:
          "Subscription limits require a ChatGPT account, rather than API key or cloud credentials.",
      });
    }
    const response = yield* client.request("account/rateLimits/read", undefined);
    return yield* decodeCodexLimits(response, DateTime.formatIso(yield* DateTime.now));
  },
  Effect.scoped,
  Effect.timeout("15 seconds"),
  Effect.mapError((error) =>
    isLimitsError(error)
      ? error
      : new ProviderLimitsError({
          reason: "requestFailed",
          detail:
            "Could not read Codex limits. Check that this instance is installed, signed in, and online, then refresh.",
        }),
  ),
);

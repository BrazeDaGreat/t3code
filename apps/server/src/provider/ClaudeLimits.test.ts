import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import { ClaudeSettings } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { claudeCredentialService, readClaudeLimits } from "./ClaudeLimits.ts";

const config = Schema.decodeSync(ClaudeSettings)({});
const usage = {
  five_hour: { utilization: 27, resets_at: null },
  seven_day: { utilization: 63, resets_at: null },
};
const encodeJson = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Unknown as Schema.Codec<unknown>),
);

function harness(status = 200, body: unknown = usage, keychainRaw = "") {
  const paths: string[] = [];
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const layer = Layer.mergeAll(
    NodePath.layer,
    FileSystem.layerNoop({
      readFileString: (path) =>
        Effect.sync(() => {
          paths.push(path);
          return {
            claudeAiOauth: { accessToken: path.includes("work") ? "work-token" : "personal-token" },
          };
        }).pipe(Effect.flatMap(encodeJson), Effect.orDie),
    }),
    Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({
      string: () => Effect.succeed(keychainRaw),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push({ url: request.url, authorization: request.headers.authorization });
          return HttpClientResponse.fromWeb(request, Response.json(body, { status }));
        }),
      ),
    ),
  );
  return { layer, paths, requests };
}

describe("Claude account limits", () => {
  it.effect("prefers the macOS keychain without reading fallback credentials", () =>
    Effect.gen(function* () {
      const raw = yield* encodeJson({ claudeAiOauth: { accessToken: "keychain-token" } });
      const test = harness(200, usage, raw);
      yield* readClaudeLimits(config, {}).pipe(
        Effect.provideService(HostProcessPlatform, "darwin"),
        Effect.provide(test.layer),
      );
      expect(test.paths).toEqual([]);
      expect(test.requests[0]?.authorization).toBe("Bearer keychain-token");
    }),
  );

  it.effect("reports a missing sign-in when credentials cannot be decoded", () =>
    Effect.gen(function* () {
      const test = harness();
      const error = yield* readClaudeLimits(config, {}).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({ readFileString: () => Effect.succeed("not-json") }),
        ),
        Effect.provide(test.layer),
        Effect.flip,
      );
      expect(error.reason).toBe("authentication");
      expect(test.requests).toEqual([]);
    }),
  );

  it.effect("reads each instance's own credentials without mixing accounts", () =>
    Effect.gen(function* () {
      const test = harness();
      const personal = yield* readClaudeLimits(
        { ...config, homePath: "/limits/personal" },
        {},
      ).pipe(Effect.provide(test.layer));
      const work = yield* readClaudeLimits({ ...config, homePath: "/limits/work" }, {}).pipe(
        Effect.provide(test.layer),
      );
      expect(personal.session?.usedPercent).toBe(27);
      expect(work.weekly?.usedPercent).toBe(63);
      expect(test.paths.map((path) => path.replaceAll("\\", "/"))).toEqual(
        expect.arrayContaining([
          expect.stringContaining("/limits/personal/.credentials.json"),
          expect.stringContaining("/limits/work/.credentials.json"),
        ]),
      );
      expect(test.requests).toEqual([
        {
          url: "https://api.anthropic.com/api/oauth/usage",
          authorization: "Bearer personal-token",
        },
        { url: "https://api.anthropic.com/api/oauth/usage", authorization: "Bearer work-token" },
      ]);
      expect(yield* encodeJson(work)).not.toContain("token");
    }),
  );

  it.effect("honors an instance OAuth token without reading stored credentials", () =>
    Effect.gen(function* () {
      const test = harness();
      yield* readClaudeLimits(config, { CLAUDE_CODE_OAUTH_TOKEN: "instance-token" }).pipe(
        Effect.provide(test.layer),
      );
      expect(test.paths).toEqual([]);
      expect(test.requests[0]?.authorization).toBe("Bearer instance-token");
    }),
  );

  it.effect("does not query subscription limits for API credentials", () =>
    Effect.gen(function* () {
      const test = harness();
      const error = yield* readClaudeLimits(config, { ANTHROPIC_API_KEY: "api-secret" }).pipe(
        Effect.provide(test.layer),
        Effect.flip,
      );
      expect(error.reason).toBe("unsupported");
      expect(test.requests).toEqual([]);
      expect(test.paths).toEqual([]);
    }),
  );

  it.effect("reports auth and throttling failures without leaking response bodies", () =>
    Effect.gen(function* () {
      for (const [status, reason] of [
        [401, "authentication"],
        [403, "authentication"],
        [429, "requestFailed"],
        [500, "requestFailed"],
      ] as const) {
        const test = harness(status, { message: "private-response" });
        const error = yield* readClaudeLimits(config, {
          CLAUDE_CODE_OAUTH_TOKEN: "private-token",
        }).pipe(Effect.provide(test.layer), Effect.flip);
        expect(error.reason).toBe(reason);
        expect(yield* encodeJson(error)).not.toContain("private");
      }
    }),
  );

  it("isolates macOS keychain namespaces and honors the secure-storage override", () => {
    expect(claudeCredentialService({}, "/home/me/.claude")).toBe("Claude Code-credentials");
    const personal = claudeCredentialService({ CLAUDE_CONFIG_DIR: "/personal" }, "/personal");
    const work = claudeCredentialService({ CLAUDE_CONFIG_DIR: "/work" }, "/work");
    expect(personal).not.toBe(work);
    expect(
      claudeCredentialService(
        { CLAUDE_CONFIG_DIR: "/work", CLAUDE_SECURESTORAGE_CONFIG_DIR: "" },
        "/work",
      ),
    ).toBe("Claude Code-credentials");
    expect(claudeCredentialService({ CLAUDE_SECURESTORAGE_CONFIG_DIR: "/personal" }, "/work")).toBe(
      personal,
    );
  });
});

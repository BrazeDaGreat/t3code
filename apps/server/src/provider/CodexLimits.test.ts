import { describe, expect, it } from "@effect/vitest";
import { CodexSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { readCodexLimits } from "./ProviderLimits.ts";

const config = Schema.decodeSync(CodexSettings)({ binaryPath: "codex", homePath: "/codex-work" });
const Request = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
    method: Schema.String,
  }),
);
const encodeJson = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Unknown as Schema.Codec<unknown>),
);
const decodeRequest = Schema.decodeUnknownEffect(Request);

function mockAccountProcess(
  accountType: "chatgpt" | "apiKey" | null = "chatgpt",
  failRead = false,
) {
  const methods: string[] = [];
  let released = false;
  let home: string | undefined;
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (command._tag === "StandardCommand") home = command.options.env?.CODEX_HOME;
      const output = yield* Queue.unbounded<Uint8Array>();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let pending = "";
      const stdin = Sink.forEach((chunk: Uint8Array) =>
        Effect.gen(function* () {
          pending += decoder.decode(chunk, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf("\n")) !== -1) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            const request = yield* decodeRequest(line).pipe(Effect.orDie);
            methods.push(request.method);
            if (request.id === undefined) continue;
            const result =
              request.method === "initialize"
                ? {
                    userAgent: "codex/1.0.0",
                    codexHome: "/codex-work",
                    platformFamily: "unix",
                    platformOs: "linux",
                  }
                : request.method === "account/read"
                  ? {
                      requiresOpenaiAuth: true,
                      account:
                        accountType === "chatgpt"
                          ? { type: "chatgpt", email: "test@example.com", planType: "plus" }
                          : accountType === "apiKey"
                            ? { type: "apiKey" }
                            : null,
                    }
                  : {
                      rateLimits: {
                        primary: { usedPercent: 21, windowDurationMins: 300 },
                        secondary: { usedPercent: 54, windowDurationMins: 10_080 },
                      },
                    };
            const response =
              failRead && request.method === "account/rateLimits/read"
                ? { id: request.id, error: { code: -32000, message: "private-provider-output" } }
                : { id: request.id, result };
            const responseLine = yield* encodeJson(response).pipe(Effect.orDie);
            yield* Queue.offer(output, encoder.encode(`${responseLine}\n`));
          }
        }),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          released = true;
        }),
      );
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(123),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin,
        stdout: Stream.fromQueue(output),
        stderr: Stream.never,
        all: Stream.never,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  return {
    spawner,
    methods,
    get released() {
      return released;
    },
    get home() {
      return home;
    },
  };
}

describe("Codex account limits", () => {
  it.effect("reads the configured account without creating a thread and releases its process", () =>
    Effect.gen(function* () {
      const mock = mockAccountProcess();
      const limits = yield* readCodexLimits(config, {}).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
      );
      expect(limits.session?.usedPercent).toBe(21);
      expect(limits.weekly?.usedPercent).toBe(54);
      expect(mock.home).toBe(config.homePath);
      expect(mock.methods).toEqual([
        "initialize",
        "initialized",
        "account/read",
        "account/rateLimits/read",
      ]);
      expect(mock.released).toBe(true);
    }),
  );

  it.effect("rejects API key and signed-out accounts without reading subscription limits", () =>
    Effect.gen(function* () {
      for (const account of ["apiKey", null] as const) {
        const mock = mockAccountProcess(account);
        const error = yield* readCodexLimits(config, {}).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
          Effect.flip,
        );
        expect(error.reason).toBe(account === null ? "authentication" : "unsupported");
        expect(mock.methods).not.toContain("account/rateLimits/read");
        expect(mock.released).toBe(true);
      }
    }),
  );

  it.effect("sanitizes provider errors and still releases the account client", () =>
    Effect.gen(function* () {
      const mock = mockAccountProcess("chatgpt", true);
      const error = yield* readCodexLimits(config, {}).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mock.spawner),
        Effect.flip,
      );
      expect(error.reason).toBe("requestFailed");
      expect(yield* encodeJson(error)).not.toContain("private-provider-output");
      expect(mock.released).toBe(true);
    }),
  );
});

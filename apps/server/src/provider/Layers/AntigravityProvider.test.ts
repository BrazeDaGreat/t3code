import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  AntigravitySettings,
  type ModelSelection,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import {
  buildInitialAntigravityProviderSnapshot,
  checkAntigravityProviderStatus,
} from "./AntigravityProvider.ts";
import { makeAntigravityAdapter } from "./AntigravityAdapter.ts";
import { makeAntigravityTextGeneration } from "../../textGeneration/AntigravityTextGeneration.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

const emptySkillsFileSystem = FileSystem.makeNoop({
  readDirectory: () => Effect.succeed([]),
});

function mockSpawner(
  stdout: string,
  code = 0,
  options: {
    readonly stderr?: string;
    readonly onSpawn?: (command: ChildProcess.Command) => void;
  } = {},
) {
  return ChildProcessSpawner.make((command) => {
    options.onSpawn?.(command);
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(stdout)),
        stderr: Stream.encodeText(Stream.make(options.stderr ?? "")),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });
}

const runRecordedTurn = Effect.fn("test.runRecordedAntigravityTurn")(function* (input: {
  readonly events: ReadonlyArray<unknown>;
  readonly printTimeout?: string;
  readonly code?: number;
  readonly stderr?: string;
  readonly modelSelection?: ModelSelection;
  readonly sessionModelSelection?: ModelSelection;
}) {
  const commands: ChildProcess.Command[] = [];
  const spawner = mockSpawner(
    input.events.map((event) => JSON.stringify(event)).join("\n"),
    input.code ?? 0,
    {
      stderr: input.stderr ?? "",
      onSpawn: (command) => {
        commands.push(command);
      },
    },
  );
  const adapter = yield* makeAntigravityAdapter(
    decodeAntigravitySettings({
      enabled: true,
      ...(input.printTimeout ? { printTimeout: input.printTimeout } : {}),
    }),
  ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
  yield* Effect.addFinalizer(() => adapter.stopAll().pipe(Effect.ignore));
  const threadId = ThreadId.make("antigravity-recorded-turn");
  const eventsFiber = yield* adapter.streamEvents.pipe(
    Stream.takeUntil((event) => event.type === "turn.completed"),
    Stream.runCollect,
    Effect.forkChild({ startImmediately: true }),
  );
  yield* adapter.startSession({
    threadId,
    cwd: process.cwd(),
    runtimeMode: "full-access",
    ...(input.sessionModelSelection ? { modelSelection: input.sessionModelSelection } : {}),
  });
  const turn = yield* adapter.sendTurn({
    threadId,
    input: "Continue the work",
    ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
  });
  return { commands, turn, events: yield* Fiber.join(eventsFiber) };
}, Effect.scoped);

describe("buildInitialAntigravityProviderSnapshot", () => {
  it.effect("returns a disabled snapshot by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialAntigravityProviderSnapshot(
        decodeAntigravitySettings({}),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns an enabled pending snapshot when enabled is true", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialAntigravityProviderSnapshot(
        decodeAntigravitySettings({ enabled: true }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.models.length).toBeGreaterThan(0);
      expect(snapshot.models[0]?.slug).toBe("gemini-3.7-flash");
    }),
  );
});

describe("checkAntigravityProviderStatus", () => {
  it.effect("reports binary as missing when binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/agy-missing-binary",
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, emptySkillsFileSystem));
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports installed CLI as unhealthy when probe exits non-zero", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({ enabled: true }),
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mockSpawner("", 2)),
        Effect.provideService(FileSystem.FileSystem, emptySkillsFileSystem),
        Effect.provide(NodeServices.layer),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Antigravity CLI is installed but failed to run.");
    }),
  );

  it.effect("reports ready status when agy is available and outputs version", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({ enabled: true }),
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mockSpawner("1.2.3\n")),
        Effect.provideService(FileSystem.FileSystem, emptySkillsFileSystem),
        Effect.provide(NodeServices.layer),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("1.2.3");
    }),
  );
});

describe("AntigravityAdapter", () => {
  it.effect("starts and stops an Antigravity session cleanly", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAntigravityAdapter(decodeAntigravitySettings({}));
      const threadId = ThreadId.make("test-antigravity-thread-1");
      const session = yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      expect(session.threadId).toBe(threadId);
      expect(session.status).toBe("ready");
      expect(session.provider).toBe("antigravity");

      const has = yield* adapter.hasSession(threadId);
      expect(has).toBe(true);

      yield* adapter.stopSession(threadId);
      const hasAfter = yield* adapter.hasSession(threadId);
      expect(hasAfter).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("retains completed turns and the conversation cursor from CLI output", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const output = [
          { event: "init", conversation_id: "mock-conv-1" },
          {
            event: "step_update",
            step_update: {
              step_index: 1,
              step_type: "agent_response",
              text_delta: "hello from mock",
              state: "DONE",
            },
          },
          { event: "result", result: { status: "SUCCESS", conversation_id: "mock-conv-1" } },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n");

        const adapter = yield* makeAntigravityAdapter(
          decodeAntigravitySettings({ enabled: true }),
        ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, mockSpawner(output)));
        const threadId = ThreadId.make("test-antigravity-mock-turn");
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        const turnResult = yield* adapter.sendTurn({
          threadId,
          input: "Hello test",
        });

        expect(turnResult.turnId).toBeTruthy();
        expect(turnResult.threadId).toBe(threadId);
        expect(turnResult.resumeCursor).toEqual({ version: 1, conversationId: "mock-conv-1" });
        expect((yield* adapter.readThread(threadId)).turns.map((turn) => turn.id)).toEqual([
          turnResult.turnId,
        ]);

        yield* adapter.stopSession(threadId);
        yield* adapter.stopAll();
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("Antigravity CLI turn results", () => {
  it.effect("maps the effort option to a native model without changing the displayed family", () =>
    Effect.gen(function* () {
      const result = yield* runRecordedTurn({
        events: [{ event: "result", result: { status: "SUCCESS" } }],
        modelSelection: {
          instanceId: ProviderInstanceId.make("antigravity"),
          model: "gemini-3.7-flash",
          options: [{ id: "effort", value: "medium" }],
        },
      });
      const command = result.commands[0];
      expect(command?._tag).toBe("StandardCommand");
      if (command?._tag === "StandardCommand") {
        expect(command.args[command.args.indexOf("--model") + 1]).toBe("gemini-3.7-flash-medium");
      }
      expect(result.events.find((event) => event.type === "turn.started")).toMatchObject({
        payload: { model: "gemini-3.7-flash", effort: "medium" },
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the session's effort when a turn omits model options", () =>
    Effect.gen(function* () {
      const result = yield* runRecordedTurn({
        events: [{ event: "result", result: { status: "SUCCESS" } }],
        sessionModelSelection: {
          instanceId: ProviderInstanceId.make("antigravity"),
          model: "gemini-3.1-pro",
          options: [{ id: "effort", value: "low" }],
        },
      });
      const command = result.commands[0];
      expect(command?._tag).toBe("StandardCommand");
      if (command?._tag === "StandardCommand") {
        expect(command.args[command.args.indexOf("--model") + 1]).toBe("gemini-3.1-pro-low");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    { configured: undefined, expected: "30m" },
    { configured: "1h", expected: "1h" },
  ])("passes the configured print timeout: $expected", ({ configured, expected }) =>
    Effect.gen(function* () {
      const result = yield* runRecordedTurn({
        events: [{ event: "result", result: { status: "SUCCESS" } }],
        ...(configured ? { printTimeout: configured } : {}),
      });
      const command = result.commands[0];
      expect(command?._tag).toBe("StandardCommand");
      if (command?._tag === "StandardCommand") {
        const flagIndex = command.args.indexOf("--print-timeout");
        expect(flagIndex).toBeGreaterThanOrEqual(0);
        expect(command.args[flagIndex + 1]).toBe(expected);
      }
      expect(result.events.at(-1)).toMatchObject({
        type: "turn.completed",
        payload: { state: "completed" },
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports the CLI timeout without discarding the resume cursor or retrying", () =>
    Effect.gen(function* () {
      const result = yield* runRecordedTurn({
        events: [
          {
            event: "result",
            result: {
              conversation_id: "timed-out-conversation",
              status: "ERROR",
              error: "timeout waiting for response",
              duration_seconds: 296.2,
            },
          },
        ],
        code: 1,
      });
      expect(result.events.at(-1)).toMatchObject({
        type: "turn.completed",
        payload: { state: "failed", errorMessage: "timeout waiting for response" },
      });
      expect(result.turn.resumeCursor).toEqual({
        version: 1,
        conversationId: "timed-out-conversation",
      });
      expect(result.commands).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("renders native tool steps, nested arguments, and command output", () =>
    Effect.gen(function* () {
      const result = yield* runRecordedTurn({
        events: [
          {
            event: "step_update",
            step_update: {
              step_index: 4,
              step_type: "tool",
              state: "ACTIVE",
              tool_info: { name: "run_command", parameters: { CommandLine: "Get-Location" } },
            },
          },
          {
            event: "step_update",
            step_update: {
              step_index: 4,
              step_type: "tool",
              state: "DONE",
              error: null,
              tool_info: {
                name: "run_command",
                parameters: { CommandLine: "Get-Location" },
                output: "D:\\Projects\\sample\n",
              },
            },
          },
          { event: "result", result: { status: "SUCCESS" } },
        ],
      });
      const toolEvents = result.events.filter((event) => event.itemId === "tool_4");
      expect(toolEvents).toMatchObject([
        {
          type: "item.started",
          payload: { itemType: "command_execution", status: "inProgress", detail: "Get-Location" },
        },
        {
          type: "content.delta",
          payload: { streamKind: "command_output", delta: "D:\\Projects\\sample\n" },
        },
        {
          type: "item.completed",
          payload: { itemType: "command_execution", status: "completed" },
        },
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps file-read tool output out of assistant messages", () =>
    Effect.gen(function* () {
      const result = yield* runRecordedTurn({
        events: [
          {
            event: "step_update",
            step_update: {
              step_index: 2,
              step_type: "tool",
              state: "DONE",
              tool_info: {
                name: "view_file",
                parameters: { AbsolutePath: "page.tsx" },
                output: "export default function Page() {}",
              },
            },
          },
          { event: "result", result: { status: "SUCCESS" } },
        ],
      });
      expect(result.events.filter((event) => event.type === "content.delta")).toEqual([]);
      expect(result.events.find((event) => event.type === "item.completed")).toMatchObject({
        payload: { itemType: "dynamic_tool_call", title: "view_file", detail: "page.tsx" },
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("explains a clean process exit that omitted the final result", () =>
    Effect.gen(function* () {
      const result = yield* runRecordedTurn({ events: [] });
      expect(result.events.at(-1)).toMatchObject({
        type: "turn.completed",
        payload: {
          state: "failed",
          errorMessage: "Antigravity CLI exited without a final result.",
        },
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("uses a bounded stderr tail when the process fails after a success result", () =>
    Effect.gen(function* () {
      const stderr = `${"x".repeat(9000)}terminal unavailable`;
      const result = yield* runRecordedTurn({
        events: [{ event: "result", result: { status: "SUCCESS" } }],
        code: 1,
        stderr,
      });
      expect(result.events.at(-1)).toMatchObject({
        type: "turn.completed",
        payload: { state: "failed", errorMessage: stderr.slice(-8192) },
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("AntigravityTextGeneration", () => {
  it.effect("uses the selected effort for text-generation helpers", () =>
    Effect.gen(function* () {
      const commands: ChildProcess.Command[] = [];
      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ enabled: true }),
      ).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          mockSpawner(JSON.stringify({ title: "Fix reconnect handling" }), 0, {
            onSpawn: (command) => {
              commands.push(command);
            },
          }),
        ),
      );
      yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "Fix reconnect handling",
        modelSelection: {
          instanceId: ProviderInstanceId.make("antigravity"),
          model: "gemini-3.7-flash",
          options: [{ id: "effort", value: "low" }],
        },
      });
      const command = commands[0];
      expect(command?._tag).toBe("StandardCommand");
      if (command?._tag === "StandardCommand") {
        expect(command.args[command.args.indexOf("--model") + 1]).toBe("gemini-3.7-flash-low");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("uses the captured spawner to generate a thread title", () =>
    Effect.gen(function* () {
      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ enabled: true }),
      ).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          mockSpawner(JSON.stringify({ title: "Fix reconnect handling" })),
        ),
      );
      const result = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "Fix reconnect handling",
        modelSelection: {
          instanceId: ProviderInstanceId.make("antigravity"),
          model: "gemini-3.7-flash-high",
        },
      });
      expect(result.title).toBe("Fix reconnect handling");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects structured output when the CLI exits with an error", () =>
    Effect.gen(function* () {
      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ enabled: true }),
      ).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          mockSpawner(JSON.stringify({ title: "Partial result" }), 2),
        ),
      );
      const error = yield* textGeneration
        .generateThreadTitle({
          cwd: process.cwd(),
          message: "Fix reconnect handling",
          modelSelection: {
            instanceId: ProviderInstanceId.make("antigravity"),
            model: "gemini-3.7-flash-high",
          },
        })
        .pipe(Effect.flip);
      expect(error._tag).toBe("TextGenerationError");
      expect(error.detail).toContain("code 2");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

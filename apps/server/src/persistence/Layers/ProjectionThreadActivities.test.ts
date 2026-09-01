import { EventId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionThreadActivityRepository } from "../Services/ProjectionThreadActivities.ts";
import { ProjectionThreadActivityRepositoryLive } from "./ProjectionThreadActivities.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

it.layer(ProjectionThreadActivityRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
  "ProjectionThreadActivityRepository",
  (it) => {
    it.effect("filters activity kinds without changing thread isolation or timeline order", () =>
      Effect.gen(function* () {
        const repository = yield* ProjectionThreadActivityRepository;
        const threadId = ThreadId.make("filtered-activities");
        const createdAt = "2026-08-01T12:00:00.000Z";
        for (const [id, kind, sequence, targetThread] of [
          ["resolved", "user-input.resolved", 3, threadId],
          ["tool", "tool.completed", 2, threadId],
          ["requested", "user-input.requested", 1, threadId],
          ["failed", "provider.user-input.respond.failed", 4, threadId],
          ["other", "user-input.requested", 5, ThreadId.make("another-thread")],
        ] as const) {
          yield* repository.upsert({
            activityId: EventId.make(id),
            threadId: targetThread,
            turnId: null,
            tone: "info",
            kind,
            summary: kind,
            payload:
              kind === "tool.completed" ? { output: "x".repeat(100_000) } : { requestId: "q1" },
            sequence,
            createdAt,
          });
        }

        const filtered = yield* repository.listByThreadId({
          threadId,
          kinds: [
            "user-input.requested",
            "user-input.resolved",
            "provider.user-input.respond.failed",
          ],
        });
        assert.deepEqual(
          filtered.map((row) => row.activityId),
          ["requested", "resolved", "failed"],
        );
        assert.deepEqual(
          filtered.map((row) => row.payload),
          Array(3).fill({ requestId: "q1" }),
        );
        assert.deepEqual(yield* repository.listByThreadId({ threadId, kinds: [] }), []);
        const all = yield* repository.listByThreadId({ threadId });
        assert.deepEqual(
          all.map((row) => row.activityId),
          ["requested", "tool", "resolved", "failed"],
        );
      }),
    );
  },
);

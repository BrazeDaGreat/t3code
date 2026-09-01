import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { decodeClaudeLimits, decodeCodexLimits } from "./ProviderLimits.ts";

const readAt = "2026-08-31T12:00:00.000Z";

describe("provider limit snapshots", () => {
  it.effect("preserves Claude percentages and normalizes reset time zones", () =>
    Effect.gen(function* () {
      const limits = yield* decodeClaudeLimits(
        {
          five_hour: { utilization: 42.5, resets_at: "2026-08-31T20:00:00+05:00" },
          seven_day: { utilization: 81, resets_at: "2026-09-04T00:00:00Z" },
          extra_usage: { is_enabled: true },
        },
        readAt,
      );
      expect(limits).toEqual({
        readAt,
        session: {
          usedPercent: 42.5,
          resetsAt: "2026-08-31T15:00:00.000Z",
          windowDurationMins: 300,
        },
        weekly: {
          usedPercent: 81,
          resetsAt: "2026-09-04T00:00:00.000Z",
          windowDurationMins: 10_080,
        },
      });
    }),
  );

  it.effect("does not invent zero usage or reset times for absent windows", () =>
    Effect.gen(function* () {
      expect(yield* decodeClaudeLimits({ five_hour: null, seven_day: null }, readAt)).toEqual({
        readAt,
        session: null,
        weekly: null,
      });
      const limits = yield* decodeCodexLimits(
        { rateLimits: { primary: { usedPercent: 0 } } },
        readAt,
      );
      expect(limits.session).toEqual({ usedPercent: 0, resetsAt: null, windowDurationMins: null });
      expect(limits.weekly).toBeNull();
    }),
  );

  it.effect("prefers Codex's account bucket and converts epoch seconds", () =>
    Effect.gen(function* () {
      const limits = yield* decodeCodexLimits(
        {
          rateLimits: { primary: { usedPercent: 99 } },
          rateLimitsByLimitId: {
            codex: {
              primary: { usedPercent: 25, resetsAt: 1_788_192_000, windowDurationMins: 300 },
              secondary: { usedPercent: 75, resetsAt: null, windowDurationMins: 10_080 },
            },
          },
        },
        readAt,
      );
      expect(limits.session).toEqual({
        usedPercent: 25,
        resetsAt: "2026-08-31T16:00:00.000Z",
        windowDurationMins: 300,
      });
      expect(limits.weekly?.usedPercent).toBe(75);
    }),
  );

  it.effect(
    "rejects malformed or unrecognized Claude responses instead of displaying misleading bars",
    () =>
      Effect.gen(function* () {
        for (const response of [
          { error: "not authenticated" },
          { five_hour: { utilization: "42", resets_at: null } },
          { five_hour: { utilization: 101, resets_at: null } },
          { five_hour: { utilization: 42, resets_at: "tomorrow" } },
        ]) {
          expect(Result.isFailure(yield* Effect.result(decodeClaudeLimits(response, readAt)))).toBe(
            true,
          );
        }
      }),
  );
});

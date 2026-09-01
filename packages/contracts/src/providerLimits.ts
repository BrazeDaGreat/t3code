import * as Schema from "effect/Schema";

import { IsoDateTime } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ProviderLimitWindow = Schema.Struct({
  usedPercent: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  resetsAt: Schema.NullOr(IsoDateTime),
  windowDurationMins: Schema.NullOr(Schema.Number),
});
export type ProviderLimitWindow = typeof ProviderLimitWindow.Type;

/** Account quotas, read on demand from this environment's configured provider instance. */
export const ProviderLimits = Schema.Struct({
  readAt: IsoDateTime,
  session: Schema.NullOr(ProviderLimitWindow),
  weekly: Schema.NullOr(ProviderLimitWindow),
});
export type ProviderLimits = typeof ProviderLimits.Type;

export const ProviderLimitsInput = Schema.Struct({ instanceId: ProviderInstanceId });

/** Never carries credentials, provider response bodies, or subprocess output over the wire. */
export class ProviderLimitsError extends Schema.TaggedErrorClass<ProviderLimitsError>()(
  "ProviderLimitsError",
  {
    reason: Schema.Literals(["unavailable", "unsupported", "authentication", "requestFailed"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

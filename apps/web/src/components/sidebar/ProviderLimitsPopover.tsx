import type { EnvironmentId, ProviderLimitWindow, ServerProvider } from "@t3tools/contracts";
import { GaugeIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const resetTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const updatedTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function LimitWindow({ label, window }: { label: string; window: ProviderLimitWindow | null }) {
  const duration = window?.windowDurationMins;
  const windowLabel =
    duration == null
      ? label
      : duration === 300
        ? "Session (5 hours)"
        : duration === 10_080
          ? "Weekly (7 days)"
          : `${label === "Weekly" ? "Secondary limit" : label} (${duration < 60 ? `${duration} min` : `${Math.round(duration / 60)} hours`})`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{windowLabel}</span>
        <span className="tabular-nums">
          {window ? `${Math.round(window.usedPercent)}% used` : "Not reported"}
        </span>
      </div>
      {window && (
        <>
          <div
            role="progressbar"
            aria-label={`${windowLabel} usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={window.usedPercent}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={
                window.usedPercent >= 90
                  ? "h-full rounded-full bg-destructive"
                  : "h-full rounded-full bg-primary"
              }
              style={{ width: `${window.usedPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {window.resetsAt ? (
              <time dateTime={window.resetsAt}>
                Resets {resetTimeFormat.format(new Date(window.resetsAt))}
              </time>
            ) : (
              "Reset time not reported"
            )}
          </p>
        </>
      )}
    </div>
  );
}

function ProviderLimitsSection({
  environmentId,
  provider,
  connected,
}: {
  environmentId: EnvironmentId;
  provider: ServerProvider;
  connected: boolean;
}) {
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    connected && provider.enabled
      ? serverEnvironment.providerLimits({
          environmentId,
          input: { instanceId: provider.instanceId },
        })
      : null,
  );
  const label = provider.displayName ?? (provider.driver === "claudeAgent" ? "Claude" : "Codex");
  const message = !connected
    ? "Connect to this environment to read limits."
    : !provider.enabled
      ? "This provider instance is disabled."
      : error;
  return (
    <section
      className="space-y-3 border-t border-border/60 py-3 first:border-t-0"
      aria-label={`${label} limits`}
      aria-busy={isPending}
    >
      <div className="flex items-center gap-2">
        <ProviderInstanceIcon
          driverKind={provider.driver}
          displayName={label}
          accentColor={provider.accentColor}
          iconClassName="size-4"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Refresh ${label} limits`}
                disabled={isPending || !connected || !provider.enabled}
                onClick={refresh}
              />
            }
          >
            <RefreshCwIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>Refresh {label} limits</TooltipPopup>
        </Tooltip>
      </div>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : data ? (
        <>
          <LimitWindow label="Session" window={data.session} />
          <LimitWindow label="Weekly" window={data.weekly} />
          <p role="status" className="text-[10px] text-muted-foreground">
            {isPending
              ? "Refreshing…"
              : `Updated ${updatedTimeFormat.format(new Date(data.readAt))}`}
          </p>
        </>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          Reading limits…
        </p>
      )}
    </section>
  );
}

function LimitsContent() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const environment =
    environments.find((entry) => entry.environmentId === (selectedId ?? primaryEnvironmentId)) ??
    environments[0];
  const providers = ["claudeAgent", "codex"].flatMap(
    (driver) =>
      environment?.serverConfig?.providers.filter((provider) => provider.driver === driver) ?? [],
  );
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <PopoverTitle className="text-sm">Provider limits</PopoverTitle>
        <PopoverClose render={<Button variant="ghost" size="icon-xs" aria-label="Close limits" />}>
          <XIcon className="size-3.5" />
        </PopoverClose>
      </div>
      {environment &&
        (environments.length > 1 ? (
          <select
            aria-label="Environment for provider limits"
            value={environment.environmentId}
            onChange={(event) => setSelectedId(event.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {environments.map((entry) => (
              <option key={entry.environmentId} value={entry.environmentId}>
                {entry.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="mb-2 truncate text-xs text-muted-foreground">{environment.label}</p>
        ))}
      <div>
        {environment &&
          providers.map((provider) => (
            <ProviderLimitsSection
              key={`${environment.environmentId}:${provider.instanceId}`}
              environmentId={environment.environmentId}
              connected={environment.connection.phase === "connected"}
              provider={provider}
            />
          ))}
        {providers.length === 0 && (
          <p className="py-3 text-xs text-muted-foreground">
            {environment?.connection.phase === "connected"
              ? "Add a Claude or Codex instance in Settings → Providers to view limits."
              : "Connect to an environment to view provider limits."}
          </p>
        )}
      </div>
      <p className="border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
        Account limits shared with other sessions. Reset times are in your local time.
      </p>
    </>
  );
}

export function ProviderLimitsPopover() {
  const [open, setOpen] = useState(false);
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <SidebarMenuButton
              aria-label="Limits"
              className="w-auto gap-1.5 px-2"
              isActive={open}
            />
          }
        >
          <GaugeIcon />
          <span className="text-xs">Limits</span>
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          align="start"
          sideOffset={8}
          className="w-80 max-w-[calc(100vw-1.5rem)]"
          viewportClassName="py-3"
        >
          {open && <LimitsContent />}
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}

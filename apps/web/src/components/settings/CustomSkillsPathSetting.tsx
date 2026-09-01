import { useId } from "react";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironments, type EnvironmentPresentation } from "~/state/environments";
import { DraftInput } from "../ui/draft-input";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

function EnvironmentSkillsPath({ environment }: { environment: EnvironmentPresentation }) {
  const inputId = useId();
  const value = useEnvironmentSettings(
    environment.environmentId,
    (settings) => settings.customSkillsPath,
  );
  const updateSettings = useUpdateEnvironmentSettings(environment.environmentId);
  const connected =
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        {environment.label}
        {!connected && " · Connect to edit"}
      </label>
      <div className="flex items-center gap-1">
        <DraftInput
          id={inputId}
          className="w-full sm:w-72"
          value={value}
          onCommit={(next) => updateSettings({ customSkillsPath: next })}
          placeholder="~/my-skills"
          maxLength={4096}
          spellCheck={false}
          disabled={!connected}
        />
        {value !== "" && connected && (
          <SettingResetButton
            label={`Clear Custom Skills Path for ${environment.label}`}
            onClick={() => updateSettings({ customSkillsPath: "" })}
          />
        )}
      </div>
    </div>
  );
}

export function CustomSkillsPathSetting() {
  const { environments } = useEnvironments();
  return (
    <SettingsRow
      {...searchableSetting("custom-skills-path")}
      description="Folder on each environment containing <skill-folder>/SKILL.md. Install copies from Skills → Custom. Leave empty to disable; originals stay unchanged."
      control={
        <div className="space-y-3">
          {environments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Connect an environment to configure its folder.
            </p>
          ) : (
            environments.map((environment) => (
              <EnvironmentSkillsPath key={environment.environmentId} environment={environment} />
            ))
          )}
        </div>
      }
    />
  );
}

import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const ProjectSkillName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9 ._():-]*$/),
);
export const ProjectSkillSource = TrimmedNonEmptyString.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
);

export const ProjectSkillsListInput = Schema.Struct({ cwd: TrimmedNonEmptyString });
export type ProjectSkillsListInput = typeof ProjectSkillsListInput.Type;

export const ProjectSkillsSearchInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMaxLength(256)),
});
export type ProjectSkillsSearchInput = typeof ProjectSkillsSearchInput.Type;

export const ProjectSkillsDescribeInput = Schema.Struct({
  source: ProjectSkillSource,
  name: ProjectSkillName,
});
export type ProjectSkillsDescribeInput = typeof ProjectSkillsDescribeInput.Type;
export const ProjectSkillsDescribeResult = Schema.Struct({
  description: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
});
export type ProjectSkillsDescribeResult = typeof ProjectSkillsDescribeResult.Type;

export const ProjectSkillSearchResult = Schema.Struct({
  name: ProjectSkillName,
  source: ProjectSkillSource,
  installs: NonNegativeInt,
});
export type ProjectSkillSearchResult = typeof ProjectSkillSearchResult.Type;
export const ProjectSkillsSearchResult = Schema.Array(ProjectSkillSearchResult);

export const ProjectInstalledSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  source: Schema.NullOr(Schema.String),
  agents: Schema.Boolean,
  claude: Schema.Boolean,
});
export type ProjectInstalledSkill = typeof ProjectInstalledSkill.Type;
export const ProjectSkillsListResult = Schema.Array(ProjectInstalledSkill);
export type ProjectSkillsListResult = typeof ProjectSkillsListResult.Type;

export const ProjectCustomSkillsListResult = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  skills: Schema.Array(
    Schema.Struct({
      name: ProjectSkillName,
      description: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
    }),
  ),
});
export type ProjectCustomSkillsListResult = typeof ProjectCustomSkillsListResult.Type;

export const ProjectCustomSkillsInstallInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
  name: ProjectSkillName,
});
export type ProjectCustomSkillsInstallInput = typeof ProjectCustomSkillsInstallInput.Type;

export const ProjectSkillsInstallInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  source: ProjectSkillSource,
  name: ProjectSkillName,
});
export type ProjectSkillsInstallInput = typeof ProjectSkillsInstallInput.Type;

export const ProjectSkillsRemoveInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  name: ProjectSkillName,
});
export type ProjectSkillsRemoveInput = typeof ProjectSkillsRemoveInput.Type;

export class ProjectSkillsError extends Schema.TaggedErrorClass<ProjectSkillsError>()(
  "ProjectSkillsError",
  { message: Schema.String },
) {}

import { type EnvironmentId, type ProjectReadFileResult, WS_METHODS } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import {
  type CreateProjectInput,
  type DeleteProjectInput,
  type UpdateProjectInput,
  createProject,
  deleteProject,
  updateProject,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createSkillCatalogAtomFamily } from "./skillCatalog.ts";

export type {
  CreateProjectInput,
  DeleteProjectInput,
  UpdateProjectInput,
} from "../operations/commands.ts";

export interface OptimisticProjectFile {
  readonly data: ProjectReadFileResult;
  readonly confirmedAgainst: object | null | undefined;
}

export interface OptimisticProjectFileTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
}

function optimisticProjectFileKey(target: OptimisticProjectFileTarget): string {
  return JSON.stringify([target.environmentId, target.cwd, target.relativePath]);
}

export function createProjectEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const projectScheduler = createAtomCommandScheduler();
  const fileScheduler = createAtomCommandScheduler();
  const optimisticFileFamily = Atom.family((key: string) =>
    Atom.make<OptimisticProjectFile | null>(null).pipe(
      Atom.withLabel(`environment-data:projects:optimistic-file:${key}`),
    ),
  );
  const projectConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { projectId: string } }) =>
      JSON.stringify([environmentId, input.projectId]),
  };
  const listSkills = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:projects:skills:list",
    tag: WS_METHODS.projectsSkillsList,
    staleTimeMs: 0,
    idleTtlMs: 60_000,
  });
  return {
    listSkills,
    listCustomSkills: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:skills:custom:list",
      tag: WS_METHODS.projectsCustomSkillsList,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    installCustomSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:skills:custom:install",
      tag: WS_METHODS.projectsCustomSkillsInstall,
      onSettled: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(listSkills({ environmentId, input: { cwd: input.cwd } })),
        ),
    }),
    skillsCatalog: createSkillCatalogAtomFamily(),
    describeSkill: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:skills:describe",
      tag: WS_METHODS.projectsSkillsDescribe,
      staleTimeMs: 30 * 60_000,
      idleTtlMs: 30 * 60_000,
    }),
    searchSkills: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:skills:search",
      tag: WS_METHODS.projectsSkillsSearch,
      staleTimeMs: 30 * 60_000,
      idleTtlMs: 30 * 60_000,
    }),
    installSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:skills:install",
      tag: WS_METHODS.projectsSkillsInstall,
      onSettled: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(listSkills({ environmentId, input: { cwd: input.cwd } })),
        ),
    }),
    removeSkill: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:skills:remove",
      tag: WS_METHODS.projectsSkillsRemove,
      onSettled: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(listSkills({ environmentId, input: { cwd: input.cwd } })),
        ),
    }),
    searchEntries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:search-entries",
      tag: WS_METHODS.projectsSearchEntries,
      staleTimeMs: 15_000,
    }),
    listEntries: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:list-entries",
      tag: WS_METHODS.projectsListEntries,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
    }),
    readFile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:projects:read-file",
      tag: WS_METHODS.projectsReadFile,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
    }),
    optimisticFile: (target: OptimisticProjectFileTarget) =>
      optimisticFileFamily(optimisticProjectFileKey(target)),
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:project:create",
      execute: (input: CreateProjectInput) => createProject(input),
      scheduler: projectScheduler,
      concurrency: projectConcurrency,
    }),
    update: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:project:update",
      execute: (input: UpdateProjectInput) => updateProject(input),
      scheduler: projectScheduler,
      concurrency: projectConcurrency,
    }),
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:project:delete",
      execute: (input: DeleteProjectInput) => deleteProject(input),
      scheduler: projectScheduler,
      concurrency: projectConcurrency,
    }),
    writeFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:projects:write-file",
      tag: WS_METHODS.projectsWriteFile,
      scheduler: fileScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.cwd, input.relativePath]),
      },
    }),
  };
}

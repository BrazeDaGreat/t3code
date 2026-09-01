import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type {
  EnvironmentId,
  ProjectCustomSkillsListResult,
  ProjectSkillSearchResult,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  mergeSkillCatalog,
  selectSkillCatalogResults,
} from "@t3tools/client-runtime/state/skill-catalog";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { toastManager } from "./ui/toast";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const emptySearchAtom = Atom.make(AsyncResult.success<ReadonlyArray<ProjectSkillSearchResult>>([]));
const emptyCustomAtom = Atom.make(
  AsyncResult.success<ProjectCustomSkillsListResult>({ path: null, skills: [] }),
);
const emptyDescriptionAtom = Atom.make(AsyncResult.success({ description: null as string | null }));

interface ProjectSkillsProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
}

function failureMessage(result: AsyncResult.AsyncResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure") return null;
  const error = Cause.squash(result.cause);
  return error instanceof Error ? error.message : "Could not load skills.";
}

function skillKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function SkillDescriptionText({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const shortened = description.length > 160 && !expanded;
  return (
    <div className="mt-1 text-xs text-muted-foreground">
      <p className="break-words">
        {shortened ? `${description.slice(0, 160).trimEnd()}…` : description}
      </p>
      {description.length > 160 && (
        <Button
          variant="link"
          size="compact"
          className="h-auto p-0 text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Read more"}
        </Button>
      )}
    </div>
  );
}

function RemoteSkillDescription({
  environmentId,
  skill,
}: {
  environmentId: EnvironmentId;
  skill: ProjectSkillSearchResult;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const descriptionAtom = open
    ? projectEnvironment.describeSkill({
        environmentId,
        input: { source: skill.source, name: skill.name },
      })
    : emptyDescriptionAtom;
  const result = useAtomValue(descriptionAtom);
  const refresh = useAtomRefresh(descriptionAtom);
  const description = Option.getOrNull(AsyncResult.value(result))?.description;
  const error = failureMessage(result);
  return (
    <div className="mt-1">
      <Button
        variant="link"
        size="compact"
        className="h-auto gap-1 p-0 text-xs text-muted-foreground"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        <ChevronDownIcon className={open ? "size-3 rotate-180" : "size-3"} />
        {open ? "Hide description" : "Description"}
      </Button>
      {open && (
        <div id={contentId} className="mt-1 text-xs text-muted-foreground">
          {description ? (
            <SkillDescriptionText description={description} />
          ) : error ? (
            <p role="alert">
              {error}{" "}
              <Button
                variant="link"
                size="compact"
                className="h-auto p-0 text-xs"
                onClick={refresh}
              >
                Retry
              </Button>
            </p>
          ) : result._tag === "Initial" || result.waiting ? (
            <p role="status">Loading description…</p>
          ) : (
            <p>No description provided.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectSkillsPopup({ environmentId, cwd, projectName }: ProjectSkillsProps) {
  const [tab, setTab] = useState<"browse" | "installed" | "custom">("installed");
  const [customQuery, setCustomQuery] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<{ name: string; action: "install" | "remove" } | null>(
    null,
  );
  const [mutationError, setMutationError] = useState<string | null>(null);
  const listAtom = projectEnvironment.listSkills({ environmentId, input: { cwd } });
  const installedResult = useAtomValue(listAtom);
  const refreshInstalled = useAtomRefresh(listAtom);
  const customAtom =
    tab === "custom"
      ? projectEnvironment.listCustomSkills({ environmentId, input: {} })
      : emptyCustomAtom;
  const customResult = useAtomValue(customAtom);
  const refreshCustom = useAtomRefresh(customAtom);
  const customLibrary = Option.getOrNull(AsyncResult.value(customResult));
  const customError = failureMessage(customResult);
  const loadingCustom = customResult._tag === "Initial" || customResult.waiting;
  const customSkills =
    customLibrary?.skills.filter((skill) =>
      `${skill.name} ${skill.description ?? ""}`
        .toLowerCase()
        .includes(customQuery.trim().toLowerCase()),
    ) ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const catalogAtom = projectEnvironment.skillsCatalog(environmentId);
  const catalog = useAtomValue(catalogAtom);
  const setCatalog = useAtomSet(catalogAtom);
  const starterAtom =
    tab === "browse"
      ? projectEnvironment.searchSkills({ environmentId, input: { query: "" } })
      : emptySearchAtom;
  const starterResult = useAtomValue(starterAtom);
  const refreshStarter = useAtomRefresh(starterAtom);
  const activeSearch = tab === "browse" && search.length >= 2 && search === normalizedQuery;
  const searchAtom = activeSearch
    ? projectEnvironment.searchSkills({ environmentId, input: { query: search } })
    : emptySearchAtom;
  const searchResult = useAtomValue(searchAtom);
  const refreshSearch = useAtomRefresh(searchAtom);
  const installed = Option.getOrElse(AsyncResult.value(installedResult), () => []);
  const remoteResults = Option.getOrElse(AsyncResult.value(searchResult), () => []);
  const results = selectSkillCatalogResults(
    mergeSkillCatalog(
      catalog,
      Option.getOrElse(AsyncResult.value(starterResult), () => []),
    ),
    normalizedQuery,
    remoteResults,
  );
  const installedError = failureMessage(installedResult);
  const searchError = normalizedQuery
    ? failureMessage(searchResult)
    : failureMessage(starterResult);
  const loadingInstalled = installedResult._tag === "Initial" || installedResult.waiting;
  const loadingSearch = activeSearch && (searchResult._tag === "Initial" || searchResult.waiting);
  const loadingStarter = starterResult._tag === "Initial" || starterResult.waiting;
  const install = useAtomCommand(projectEnvironment.installSkill, { reportFailure: false });
  const installCustom = useAtomCommand(projectEnvironment.installCustomSkill, {
    reportFailure: false,
  });
  const remove = useAtomCommand(projectEnvironment.removeSkill, { reportFailure: false });

  useEffect(() => {
    if (tab !== "browse") return;
    const timer = window.setTimeout(() => setSearch(normalizedQuery), 350);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery, tab]);

  useEffect(() => {
    const starter = Option.getOrElse(AsyncResult.value(starterResult), () => []);
    const found = Option.getOrElse(AsyncResult.value(searchResult), () => []);
    if (starter.length === 0 && found.length === 0) return;
    setCatalog((previous) => mergeSkillCatalog(previous, [...starter, ...found]));
  }, [starterResult, searchResult, setCatalog]);

  async function mutate(name: string, skill?: ProjectSkillSearchResult | { sourcePath: string }) {
    if (pending !== null) return;
    setPending({ name, action: skill ? "install" : "remove" });
    setMutationError(null);
    try {
      const result = skill
        ? "sourcePath" in skill
          ? await installCustom({
              environmentId,
              input: { cwd, name, sourcePath: skill.sourcePath },
            })
          : await install({ environmentId, input: { cwd, name, source: skill.source } })
        : await remove({ environmentId, input: { cwd, name } });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        setMutationError(error instanceof Error ? error.message : "The skills operation failed.");
      } else {
        toastManager.add({
          type: "success",
          title: skill ? `Installed ${name}` : `Removed ${name}`,
          description: projectName,
        });
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <DialogPopup className="max-h-[min(80vh,36rem)] overflow-hidden">
      <DialogHeader>
        <DialogTitle>Skills</DialogTitle>
        <DialogDescription className="truncate pr-4">
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} />}>{projectName}</TooltipTrigger>
            <TooltipPopup className="max-w-sm break-all">{cwd}</TooltipPopup>
          </Tooltip>
        </DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 items-center justify-between gap-2 px-6 pb-3">
        <ToggleGroup
          variant="segmented"
          aria-label="Skill view"
          value={[tab]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "installed" || next === "browse" || next === "custom") {
              setTab(next);
              setMutationError(null);
            }
          }}
        >
          <Toggle value="installed">
            Installed
            <span className="text-muted-foreground tabular-nums">
              {loadingInstalled ? "…" : installedError ? "—" : installed.length}
            </span>
          </Toggle>
          <Toggle value="browse">Browse</Toggle>
          <Toggle value="custom">Custom</Toggle>
        </ToggleGroup>
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-label="Refresh skills"
          disabled={
            pending !== null ||
            loadingInstalled ||
            (tab === "browse" && loadingSearch) ||
            (tab === "custom" && loadingCustom)
          }
          onClick={() => {
            refreshInstalled();
            if (tab === "custom") refreshCustom();
            if (tab === "browse") {
              if (activeSearch) refreshSearch();
              else refreshStarter();
            }
          }}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {tab === "browse" && (
        <form
          className="shrink-0 px-6 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(normalizedQuery);
            if (activeSearch) refreshSearch();
          }}
        >
          <InputGroup>
            <InputGroupAddon className="text-muted-foreground">
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search skills.sh"
              placeholder="Search skills.sh…"
              maxLength={256}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <Button
                type="submit"
                size="compact"
                variant="ghost"
                disabled={normalizedQuery.length < 2 || loadingSearch}
              >
                Search
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </form>
      )}
      {tab === "custom" && (
        <div className="shrink-0 px-6 pb-3">
          <InputGroup>
            <InputGroupAddon className="text-muted-foreground">
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Filter custom skills"
              placeholder="Filter custom skills…"
              maxLength={256}
              value={customQuery}
              onChange={(event) => setCustomQuery(event.target.value)}
            />
          </InputGroup>
        </div>
      )}
      <DialogPanel scrollFade={false}>
        <div
          className="min-h-40"
          aria-busy={
            tab === "browse"
              ? loadingSearch || (!normalizedQuery && loadingStarter)
              : tab === "custom"
                ? loadingCustom || loadingInstalled
                : loadingInstalled
          }
        >
          {(mutationError ||
            installedError ||
            (tab === "browse" && searchError) ||
            (tab === "custom" && customError)) && (
            <p
              role="alert"
              className="mb-3 whitespace-pre-wrap break-words text-xs text-destructive-foreground"
            >
              {mutationError || installedError || (tab === "custom" ? customError : searchError)}
            </p>
          )}
          {pending !== null && (
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              {pending.action === "install" ? "Installing" : "Removing"} {pending.name}…
            </p>
          )}
          {tab === "browse" && loadingInstalled && (
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              Checking project skills…
            </p>
          )}
          {tab === "custom" ? (
            <>
              {loadingCustom && (
                <p role="status" className="mb-2 text-xs text-muted-foreground">
                  Reading custom skills…
                </p>
              )}
              {customLibrary?.path && (
                <p className="mb-3 break-all text-xs text-muted-foreground">{customLibrary.path}</p>
              )}
              {!loadingCustom && !customError && !customLibrary?.path ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  Set Custom Skills Path for this environment in Settings → General to browse your
                  own skills.
                  <div>
                    <Button
                      variant="outline"
                      size="compact"
                      render={<Link to="/settings/general" hash="custom-skills-path" />}
                    >
                      Open Settings
                    </Button>
                  </div>
                </div>
              ) : !loadingCustom && !customError && customSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {customQuery.trim()
                    ? "No custom skills match this filter."
                    : "No skills found. Add a folder containing SKILL.md inside your custom skills folder, then refresh."}
                </p>
              ) : null}
              <ul className="divide-y">
                {customSkills.map((skill) => {
                  const existing = installed.find(
                    (item) => skillKey(item.name) === skillKey(skill.name),
                  );
                  return (
                    <li key={skill.name} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm">{skill.name}</p>
                        {skill.description ? (
                          <SkillDescriptionText description={skill.description} />
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            No description provided.
                          </p>
                        )}
                        {existing && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            A skill with this name is in the project. Remove it from Installed to
                            replace it.
                          </p>
                        )}
                      </div>
                      <Button
                        size="compact"
                        variant="outline"
                        className="shrink-0"
                        disabled={
                          pending !== null ||
                          loadingInstalled ||
                          loadingCustom ||
                          installedError !== null ||
                          customError !== null ||
                          existing !== undefined ||
                          !customLibrary?.path
                        }
                        onClick={() => {
                          if (customLibrary?.path)
                            void mutate(skill.name, { sourcePath: customLibrary.path });
                        }}
                      >
                        {existing ? <CheckIcon /> : <DownloadIcon />}
                        {existing
                          ? "In project"
                          : pending?.name === skill.name && pending.action === "install"
                            ? "Installing…"
                            : "Install"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : tab === "browse" ? (
            <>
              {loadingSearch || (!normalizedQuery && loadingStarter) ? (
                <p role="status" className="mb-2 text-xs text-muted-foreground">
                  {normalizedQuery
                    ? "Searching for more skills…"
                    : "Loading a small starter catalog…"}
                </p>
              ) : results.length === 0 && !searchError && search === normalizedQuery ? (
                <p className="text-sm text-muted-foreground">
                  {normalizedQuery.length < 2
                    ? "Type at least two characters to find skills."
                    : "No skills found. Try another search."}
                </p>
              ) : null}
              {searchError && results.length > 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Showing cached matches. You can keep searching or retry.
                </p>
              )}
              <ul className="divide-y">
                {results.map((skill) => {
                  const existing = installed.find(
                    (item) => skillKey(item.name) === skillKey(skill.name),
                  );
                  const conflict = existing !== undefined && existing.source !== skill.source;
                  const complete = !conflict && existing?.agents && existing.claude;
                  return (
                    <li
                      key={`${skill.source}/${skill.name}`}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm">{skill.name}</p>
                        <p className="break-all text-xs text-muted-foreground">
                          {skill.source} · {skill.installs.toLocaleString()} installs
                        </p>
                        {conflict && (
                          <p className="text-xs text-muted-foreground">
                            A different skill with this name is installed.
                          </p>
                        )}
                        {!conflict && existing?.description ? (
                          <SkillDescriptionText description={existing.description} />
                        ) : (
                          <RemoteSkillDescription environmentId={environmentId} skill={skill} />
                        )}
                      </div>
                      {complete ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <CheckIcon className="size-3.5" />
                          Installed
                        </span>
                      ) : (
                        <Button
                          size="compact"
                          variant="outline"
                          className="shrink-0"
                          disabled={
                            pending !== null ||
                            loadingInstalled ||
                            installedError !== null ||
                            conflict
                          }
                          onClick={() => void mutate(skill.name, skill)}
                        >
                          <DownloadIcon />
                          {pending?.name === skill.name && pending.action === "install"
                            ? "Installing…"
                            : existing
                              ? "Add to both"
                              : "Install"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              {loadingInstalled && (
                <p role="status" className="text-sm text-muted-foreground">
                  Checking installed skills…
                </p>
              )}
              {!loadingInstalled && installed.length === 0 && !installedError && (
                <p className="text-sm text-muted-foreground">
                  No skills in this project yet.{" "}
                  <Button
                    variant="link"
                    size="compact"
                    className="h-auto p-0"
                    onClick={() => setTab("browse")}
                  >
                    Browse skills
                  </Button>
                </p>
              )}
              <ul className="divide-y">
                {installed.map((skill) => (
                  <li key={skill.name} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm">{skill.name}</p>
                      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span className="break-all">{skill.source ?? "Local skill"}</span>
                        <span className="font-mono">
                          {[skill.agents ? ".agents" : null, skill.claude ? ".claude" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </p>
                      {skill.description ? (
                        <SkillDescriptionText description={skill.description} />
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          No description provided.
                        </p>
                      )}
                    </div>
                    <Button
                      size="compact"
                      variant="ghost-muted"
                      className="shrink-0"
                      disabled={pending !== null || loadingInstalled}
                      aria-label={`Remove ${skill.name} from all agents in this project`}
                      onClick={() => void mutate(skill.name)}
                    >
                      <Trash2Icon />
                      {pending?.name === skill.name && pending.action === "remove"
                        ? "Removing…"
                        : "Remove"}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </DialogPanel>
      <p className="shrink-0 border-t px-6 py-3 text-xs text-muted-foreground">
        {tab === "installed"
          ? "Removal affects all agents in this project. Global skills stay unchanged."
          : tab === "custom"
            ? "Copies to .agents and .claude. Your custom library stays unchanged."
            : "Installs to .agents and .claude. Choose sources you trust."}
      </p>
    </DialogPopup>
  );
}

export function ProjectSkillsControl(props: ProjectSkillsProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <BookOpenIcon />
        Skills
      </DialogTrigger>
      {open && <ProjectSkillsPopup {...props} />}
    </Dialog>
  );
}

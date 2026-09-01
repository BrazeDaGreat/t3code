// @effect-diagnostics nodeBuiltinImport:off - Real filesystem fixtures need Windows junctions, which Effect's symlink API cannot create.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ProcessRunner, type ProcessRunOutput } from "../processRunner.ts";
import { ProjectSkills, layer } from "./ProjectSkills.ts";
import { ServerSettingsService, layerTest as settingsLayerTest } from "../serverSettings.ts";

const run = vi.fn<ProcessRunner["Service"]["run"]>();
const httpResponse = vi.fn<(url: string) => Response>();
const testLayer = layer.pipe(
  Layer.provideMerge(settingsLayerTest()),
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ProcessRunner)({ run }),
      NodeServices.layer,
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => HttpClientResponse.fromWeb(request, httpResponse(request.url))),
        ),
      ),
    ),
  ),
);

function output(stdout: string, code = 0): ProcessRunOutput {
  return {
    stdout,
    stderr: "",
    code: ChildProcessSpawner.ExitCode(code),
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
    stderrInvalidUtf8: false,
  };
}

let cwd: string;
const target = () => ({ cwd, source: "owner/repo", name: "test-skill" });

async function writeSkill(agent: string, name: string) {
  const directory = NodePath.join(cwd, agent, "skills", name);
  await NodeFSP.mkdir(directory, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(directory, "SKILL.md"),
    "---\nname: " + name + "\n---\nInstructions",
  );
}

async function installFixture() {
  await writeSkill(".agents", "test-skill");
  await writeSkill(".claude", "test-skill");
  await NodeFSP.writeFile(
    NodePath.join(cwd, "skills-lock.json"),
    '{"version":1,"skills":{"test-skill":{"source":"owner/repo"}}}',
  );
}

async function removeFixture() {
  for (const agent of [".agents", ".claude"]) {
    const directory = NodePath.resolve(cwd, agent, "skills", "test-skill");
    expect(NodePath.relative(cwd, directory).startsWith("..")).toBe(false);
    expect(NodePath.isAbsolute(NodePath.relative(cwd, directory))).toBe(false);
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}

beforeEach(async () => {
  cwd = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-test-"));
});

afterEach(async () => {
  run.mockReset();
  httpResponse.mockReset();
  expect(NodePath.dirname(NodePath.resolve(cwd))).toBe(NodePath.resolve(NodeOS.tmpdir()));
  expect(NodePath.basename(cwd)).toMatch(/^t3-skills-test-/);
  await NodeFSP.rm(cwd, { recursive: true, force: true });
});

describe("ProjectSkills", () => {
  it.effect("keeps custom discovery offline and empty until a path is configured", () =>
    Effect.gen(function* () {
      const skills = yield* ProjectSkills;
      expect(yield* skills.listCustom()).toEqual({ path: null, skills: [] });
      expect(run).not.toHaveBeenCalled();
      expect(httpResponse).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("lists only immediate custom skill folders and reads descriptions", () =>
    Effect.gen(function* () {
      const library = NodePath.join(cwd, "library");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(library, "review"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(library, "review", "SKILL.md"),
          "---\ndescription: Reviews pull requests.\n---\nInstructions",
        );
        await NodeFSP.mkdir(NodePath.join(library, "nested", "hidden"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(library, "nested", "hidden", "SKILL.md"), "Hidden");
        await NodeFSP.writeFile(NodePath.join(library, "README.md"), "Library");
      });
      const settings = yield* ServerSettingsService;
      yield* settings.updateSettings({ customSkillsPath: library });
      const skills = yield* ProjectSkills;
      expect((yield* skills.listCustom()).skills).toEqual([
        { name: "review", description: "Reviews pull requests." },
      ]);
      yield* settings.updateSettings({ customSkillsPath: "" });
      expect(yield* skills.listCustom()).toEqual({ path: null, skills: [] });
      expect(run).not.toHaveBeenCalled();
      expect(httpResponse).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "copies custom instructions and supporting files to both agents without modifying the library",
    () =>
      Effect.gen(function* () {
        const library = NodePath.join(cwd, "library");
        const source = NodePath.join(library, "review");
        const markdown = "---\ndescription: Reviews pull requests.\n---\nOriginal instructions";
        const bytes = new Uint8Array([0, 127, 255]);
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(NodePath.join(source, "scripts"), { recursive: true });
          await NodeFSP.writeFile(NodePath.join(source, "SKILL.md"), markdown);
          await NodeFSP.writeFile(NodePath.join(source, "scripts", "data.bin"), bytes);
        });
        const settings = yield* ServerSettingsService;
        yield* settings.updateSettings({ customSkillsPath: library });
        const skills = yield* ProjectSkills;
        const listed = yield* skills.listCustom();
        const result = yield* skills.installCustom({
          cwd,
          name: "review",
          sourcePath: listed.path!,
        });
        expect(result).toEqual([
          {
            name: "review",
            description: "Reviews pull requests.",
            source: null,
            agents: true,
            claude: true,
          },
        ]);
        yield* Effect.promise(async () => {
          for (const agent of [".agents", ".claude"]) {
            expect(
              await NodeFSP.readFile(
                NodePath.join(cwd, agent, "skills", "review", "SKILL.md"),
                "utf8",
              ),
            ).toBe(markdown);
            expect(
              new Uint8Array(
                await NodeFSP.readFile(
                  NodePath.join(cwd, agent, "skills", "review", "scripts", "data.bin"),
                ),
              ),
            ).toEqual(bytes);
          }
          await NodeFSP.writeFile(
            NodePath.join(cwd, ".agents", "skills", "review", "SKILL.md"),
            "Project edit",
          );
          expect(await NodeFSP.readFile(NodePath.join(source, "SKILL.md"), "utf8")).toBe(markdown);
          expect(
            await NodeFSP.readFile(
              NodePath.join(cwd, ".claude", "skills", "review", "SKILL.md"),
              "utf8",
            ),
          ).toBe(markdown);
        });
        expect(run).not.toHaveBeenCalled();
        expect(httpResponse).not.toHaveBeenCalled();
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "rejects missing and relative libraries and stale selections after a settings change",
    () =>
      Effect.gen(function* () {
        const settings = yield* ServerSettingsService;
        const skills = yield* ProjectSkills;
        yield* settings.updateSettings({ customSkillsPath: "relative-library" });
        expect((yield* Effect.flip(skills.listCustom())).message).toContain("absolute path");
        yield* settings.updateSettings({ customSkillsPath: NodePath.join(cwd, "missing") });
        expect((yield* Effect.flip(skills.listCustom())).message).toContain("Could not access");
        yield* settings.updateSettings({ customSkillsPath: cwd });
        expect(
          (yield* Effect.flip(
            skills.installCustom({
              cwd,
              name: "review",
              sourcePath: NodePath.join(cwd, "old-library"),
            }),
          )).message,
        ).toContain("changed");
        expect(
          (yield* Effect.flip(skills.installCustom({ cwd, name: "../escape", sourcePath: cwd })))
            .message,
        ).toContain("Invalid");
        expect(run).not.toHaveBeenCalled();
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("refuses to overwrite an existing destination even without SKILL.md", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(cwd, "library", "review"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(cwd, "library", "review", "SKILL.md"),
          "New instructions",
        );
        await NodeFSP.mkdir(NodePath.join(cwd, ".claude", "skills", "review"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(cwd, ".claude", "skills", "review", "keep.txt"),
          "Do not overwrite",
        );
      });
      const settings = yield* ServerSettingsService;
      yield* settings.updateSettings({ customSkillsPath: NodePath.join(cwd, "library") });
      const skills = yield* ProjectSkills;
      const listed = yield* skills.listCustom();
      expect(
        (yield* Effect.flip(
          skills.installCustom({ cwd, name: "review", sourcePath: listed.path! }),
        )).message,
      ).toContain("already exists");
      yield* Effect.promise(async () => {
        expect(
          await NodeFSP.readFile(
            NodePath.join(cwd, ".claude", "skills", "review", "keep.txt"),
            "utf8",
          ),
        ).toBe("Do not overwrite");
        await expect(
          NodeFSP.stat(NodePath.join(cwd, ".agents", "skills", "review")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("clears stale remote provenance only for the custom skill being installed", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(cwd, "library", "review"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(cwd, "library", "review", "SKILL.md"),
          "Custom instructions",
        );
        await writeSkill(".agents", "other");
        await NodeFSP.writeFile(
          NodePath.join(cwd, "skills-lock.json"),
          '{"version":1,"skills":{"review":{"source":"old/repo"},"other":{"source":"keep/repo"}}}',
        );
      });
      const settings = yield* ServerSettingsService;
      yield* settings.updateSettings({ customSkillsPath: NodePath.join(cwd, "library") });
      const skills = yield* ProjectSkills;
      const listed = yield* skills.listCustom();
      const installed = yield* skills.installCustom({
        cwd,
        name: "review",
        sourcePath: listed.path!,
      });
      expect(installed.find((skill) => skill.name === "review")?.source).toBeNull();
      expect(installed.find((skill) => skill.name === "other")?.source).toBe("keep/repo");
      const lock = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(cwd, "skills-lock.json"), "utf8"),
      );
      expect(lock).toContain('"version":1');
      expect(lock).not.toContain("old/repo");
      expect(lock).toContain("keep/repo");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rolls back both newly created copies when lockfile cleanup fails", () =>
    Effect.gen(function* () {
      const library = NodePath.join(cwd, "library");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(library, "review"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(library, "review", "SKILL.md"), "Original");
        // Discovery tolerates this malformed lockfile, but installation cannot update it.
        await NodeFSP.mkdir(NodePath.join(cwd, "skills-lock.json"));
      });
      const settings = yield* ServerSettingsService;
      yield* settings.updateSettings({ customSkillsPath: library });
      const skills = yield* ProjectSkills;
      const listed = yield* skills.listCustom();
      yield* Effect.flip(skills.installCustom({ cwd, name: "review", sourcePath: listed.path! }));
      expect(yield* skills.list({ cwd })).toEqual([]);
      yield* Effect.promise(async () => {
        for (const agent of [".agents", ".claude"]) {
          expect(await NodeFSP.readdir(NodePath.join(cwd, agent, "skills"))).toEqual([]);
        }
        expect(await NodeFSP.readFile(NodePath.join(library, "review", "SKILL.md"), "utf8")).toBe(
          "Original",
        );
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects linked supporting folders and project destinations outside the project", () =>
    Effect.gen(function* () {
      const library = NodePath.join(cwd, "library");
      const project = NodePath.join(cwd, "project");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(library, "review"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(library, "review", "SKILL.md"), "Instructions");
        await NodeFSP.mkdir(NodePath.join(cwd, "outside"));
        await NodeFSP.mkdir(project);
        await NodeFSP.symlink(
          NodePath.join(cwd, "outside"),
          NodePath.join(library, "review", "linked"),
          "junction",
        );
      });
      const settings = yield* ServerSettingsService;
      yield* settings.updateSettings({ customSkillsPath: library });
      const skills = yield* ProjectSkills;
      const listed = yield* skills.listCustom();
      expect(
        (yield* Effect.flip(
          skills.installCustom({ cwd: project, name: "review", sourcePath: listed.path! }),
        )).message,
      ).toContain("symbolic links");
      yield* Effect.promise(async () => {
        await NodeFSP.unlink(NodePath.join(library, "review", "linked"));
        await NodeFSP.symlink(
          NodePath.join(cwd, "outside"),
          NodePath.join(project, ".agents"),
          "junction",
        );
      });
      expect(
        (yield* Effect.flip(
          skills.installCustom({ cwd: project, name: "review", sourcePath: listed.path! }),
        )).message,
      ).toContain("inside the project");
      expect(yield* Effect.promise(() => NodeFSP.readdir(NodePath.join(cwd, "outside")))).toEqual(
        [],
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("does not create files when a project agent folder points into the source skill", () =>
    Effect.gen(function* () {
      const library = NodePath.join(cwd, "library");
      const source = NodePath.join(library, "review");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(source, { recursive: true });
        await NodeFSP.writeFile(NodePath.join(source, "SKILL.md"), "Original");
        await NodeFSP.symlink(source, NodePath.join(cwd, ".agents"), "junction");
      });
      const settings = yield* ServerSettingsService;
      yield* settings.updateSettings({ customSkillsPath: library });
      const skills = yield* ProjectSkills;
      const listed = yield* skills.listCustom();
      expect(
        (yield* Effect.flip(
          skills.installCustom({ cwd, name: "review", sourcePath: listed.path! }),
        )).message,
      ).toContain("source folder");
      expect(yield* Effect.promise(() => NodeFSP.readdir(source))).toEqual(["SKILL.md"]);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect("reads installed descriptions locally and falls back to the second copy", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await writeSkill(".agents", "test-skill");
        await writeSkill(".claude", "test-skill");
        await NodeFSP.writeFile(
          NodePath.join(cwd, ".claude/skills/test-skill/SKILL.md"),
          "---\nname: test-skill\ndescription: >-\n  Reviews code\n  for regressions.\n---\nBody",
        );
      });
      const skills = yield* ProjectSkills;
      expect(yield* skills.list({ cwd })).toEqual([
        {
          name: "test-skill",
          source: null,
          agents: true,
          claude: true,
          description: "Reviews code for regressions.",
        },
      ]);
      expect(run).not.toHaveBeenCalled();
      expect(httpResponse).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps an installed skill visible when its metadata exceeds the read limit", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await writeSkill(".agents", "large-skill");
        await NodeFSP.writeFile(
          NodePath.join(cwd, ".agents/skills/large-skill/SKILL.md"),
          `---\n# ${"x".repeat(20_000)}\ndescription: Too far into the file\n---\nBody`,
        );
      });
      const skills = yield* ProjectSkills;
      expect(yield* skills.list({ cwd })).toEqual([
        { name: "large-skill", source: null, agents: true, claude: false },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("loads a remote description only through the separate detail request", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(
        new Response(
          '<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Test Skill","description":"Reviews code for regressions."}</script>',
        ),
      );
      const skills = yield* ProjectSkills;
      expect(httpResponse).not.toHaveBeenCalled();
      expect(yield* skills.describe({ source: "owner/repo", name: "Test Skill" })).toEqual({
        description: "Reviews code for regressions.",
      });
      expect(httpResponse).toHaveBeenCalledExactlyOnceWith(
        "https://skills.sh/owner/repo/test-skill",
      );
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("handles absent descriptions and rejects unsafe sources without fetching", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(new Response("<html>No metadata</html>"));
      const skills = yield* ProjectSkills;
      expect(yield* skills.describe({ source: "owner/repo", name: "sample" })).toEqual({
        description: null,
      });
      yield* skills
        .describe({ source: "https://other.example/path", name: "sample" })
        .pipe(Effect.flip);
      yield* skills.describe({ source: "owner/repo", name: "../private" }).pipe(Effect.flip);
      expect(httpResponse).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reports failed description fetches so they can be retried", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(new Response("Unavailable", { status: 503 }));
      const skills = yield* ProjectSkills;
      expect(
        (yield* skills.describe({ source: "owner/repo", name: "sample" }).pipe(Effect.flip))
          .message,
      ).toContain("Could not load this skill's description");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("bounds remote description downloads", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(new Response("x".repeat(2 * 1024 * 1024 + 1)));
      const skills = yield* ProjectSkills;
      expect(
        (yield* skills.describe({ source: "owner/repo", name: "sample" }).pipe(Effect.flip))
          .message,
      ).toContain("too large");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reads and merges project skill files without a CLI or network request", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await installFixture();
        await writeSkill(".claude", "claude-only");
        await writeSkill(".agents", "local-skill");
        await writeSkill("global", "not-project-scoped");
        await NodeFSP.mkdir(NodePath.join(cwd, ".agents/skills/not-a-skill"));
        await NodeFSP.writeFile(NodePath.join(cwd, ".agents/skills/README.md"), "Not a skill");
      });
      const skills = yield* ProjectSkills;
      expect(yield* skills.list({ cwd })).toEqual([
        { name: "claude-only", source: null, agents: false, claude: true },
        { name: "local-skill", source: null, agents: true, claude: false },
        { name: "test-skill", source: "owner/repo", agents: true, claude: true },
      ]);
      expect(run).not.toHaveBeenCalled();
      expect(httpResponse).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("follows linked skill directories and ignores dangling links", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await writeSkill(".agents", "linked");
        const directory = NodePath.join(cwd, ".claude/skills");
        await NodeFSP.mkdir(directory, { recursive: true });
        await NodeFSP.symlink(
          NodePath.join(cwd, ".agents/skills/linked"),
          NodePath.join(directory, "linked"),
          "junction",
        );
        await NodeFSP.symlink(
          NodePath.join(cwd, "missing"),
          NodePath.join(directory, "dangling"),
          "junction",
        );
      });
      const skills = yield* ProjectSkills;
      expect(yield* skills.list({ cwd })).toEqual([
        { name: "linked", source: null, agents: true, claude: true },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("treats missing skill directories as empty", () =>
    Effect.gen(function* () {
      const skills = yield* ProjectSkills;
      expect(yield* skills.list({ cwd })).toEqual([]);
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps manual skills visible without valid lockfile metadata", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeSkill(".agents", "local"));
      const skills = yield* ProjectSkills;
      for (const text of ["", "invalid json", '{"skills":{"local":null}}']) {
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(cwd, "skills-lock.json"), text),
        );
        expect(yield* skills.list({ cwd })).toEqual([
          { name: "local", source: null, agents: true, claude: false },
        ]);
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("uses normalized lockfile names for provenance and ignores stale entries", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await writeSkill(".agents", "my-skill");
        await NodeFSP.writeFile(
          NodePath.join(cwd, "skills-lock.json"),
          '{"skills":{"My Skill":{"source":"owner/repo"},"missing":{"source":"owner/repo"}}}',
        );
      });
      const skills = yield* ProjectSkills;
      expect(yield* skills.list({ cwd })).toEqual([
        { name: "my-skill", source: "owner/repo", agents: true, claude: false },
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("surfaces filesystem failures instead of reporting no skills", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(cwd, ".agents"));
        await NodeFSP.writeFile(NodePath.join(cwd, ".agents/skills"), "not a directory");
      });
      const skills = yield* ProjectSkills;
      expect((yield* skills.list({ cwd }).pipe(Effect.flip)).message).toContain(
        "Could not read project skills",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "installs to both project directories and verifies the files without another CLI call",
    () =>
      Effect.gen(function* () {
        run.mockReturnValue(
          Effect.promise(async () => {
            await installFixture();
            return output("installed");
          }),
        );
        const skills = yield* ProjectSkills;
        expect(yield* skills.install(target())).toEqual([
          { name: "test-skill", source: "owner/repo", agents: true, claude: true },
        ]);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0]?.[0]).toMatchObject({
          cwd: yield* Effect.promise(() => NodeFSP.realpath(cwd)),
          stdin: "",
          args: [
            "--yes",
            "skills@1.5.23",
            "add",
            "owner/repo",
            "--skill",
            "test-skill",
            "--agent",
            "codex",
            "claude-code",
            "--copy",
            "--yes",
          ],
        });
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("refuses to overwrite a local skill with the same name", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeSkill(".agents", "test-skill"));
      const skills = yield* ProjectSkills;
      expect((yield* skills.install(target()).pipe(Effect.flip)).message).toContain(
        "another source",
      );
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("does not report success for a partial installation", () =>
    Effect.gen(function* () {
      run.mockReturnValue(
        Effect.promise(async () => {
          await writeSkill(".agents", "test-skill");
          return output("installed");
        }),
      );
      const skills = yield* ProjectSkills;
      expect((yield* skills.install(target()).pipe(Effect.flip)).message).toContain(
        "not found in both",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects wildcard removal and option-like names without invoking the CLI", () =>
    Effect.gen(function* () {
      const skills = yield* ProjectSkills;
      yield* skills.remove({ cwd, name: "*" }).pipe(Effect.flip);
      yield* skills.install({ ...target(), name: "--all" }).pipe(Effect.flip);
      yield* skills.install({ ...target(), source: "--global" }).pipe(Effect.flip);
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes only the named project skill across agents, leaving globals untouched", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await installFixture();
        await writeSkill("global", "test-skill");
      });
      run.mockReturnValue(
        Effect.promise(async () => {
          await removeFixture();
          return output("removed");
        }),
      );
      const skills = yield* ProjectSkills;
      expect(yield* skills.remove(target())).toEqual([]);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[0].args).toEqual([
        "--yes",
        "skills@1.5.23",
        "remove",
        "test-skill",
        "--yes",
      ]);
      expect(
        yield* Effect.promise(() =>
          NodeFSP.stat(NodePath.join(cwd, "global/skills/test-skill/SKILL.md")),
        ),
      ).toBeDefined();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reports a failed removal even when the CLI exits successfully", () =>
    Effect.gen(function* () {
      yield* Effect.promise(installFixture);
      run.mockReturnValue(Effect.succeed(output("could not remove")));
      const skills = yield* ProjectSkills;
      expect((yield* skills.remove(target()).pipe(Effect.flip)).message).toContain(
        "still installed",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("surfaces CLI failure text without terminal escapes", () =>
    Effect.gen(function* () {
      run.mockReturnValue(Effect.succeed(output("\u001b[31mRepository unavailable\u001b[0m", 1)));
      const skills = yield* ProjectSkills;
      expect((yield* skills.install(target()).pipe(Effect.flip)).message).toBe(
        "The skills CLI failed.\nRepository unavailable",
      );
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect("searches the directory and sorts structured results by install count", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(
        Response.json({
          skills: [
            { name: "first", source: "owner/repo", installs: 2 },
            { name: "second", source: "owner/repo", installs: 10 },
          ],
        }),
      );
      const skills = yield* ProjectSkills;
      expect((yield* skills.search({ query: "react" })).map((skill) => skill.name)).toEqual([
        "second",
        "first",
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("fetches only eight starter entries and expands only for an explicit query", () =>
    Effect.gen(function* () {
      httpResponse.mockImplementation(() =>
        Response.json({
          skills: Array.from({ length: 30 }, (_, index) => ({
            name: `skill-${index}`,
            source: "owner/repo",
            installs: index,
          })),
        }),
      );
      const skills = yield* ProjectSkills;
      expect(yield* skills.search({ query: "" })).toHaveLength(8);
      expect(httpResponse).toHaveBeenLastCalledWith("https://skills.sh/api/search?q=agent&limit=8");
      expect(yield* skills.search({ query: "react" })).toHaveLength(20);
      expect(httpResponse).toHaveBeenLastCalledWith(
        "https://skills.sh/api/search?q=react&limit=20",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("distinguishes directory failures from an empty search", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(new Response("Unavailable", { status: 503 }));
      const skills = yield* ProjectSkills;
      expect((yield* skills.search({ query: "react" }).pipe(Effect.flip)).message).toContain(
        "HTTP 503",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "keeps installable results when the directory includes hosted or malformed entries",
    () =>
      Effect.gen(function* () {
        httpResponse.mockReturnValue(
          Response.json({
            skills: [
              {
                id: "open.feishu.cn/lark-vc-agent",
                skillId: "lark-vc-agent",
                name: "lark-vc-agent",
                installs: 577374,
                source: "open.feishu.cn",
              },
              { name: "agent-browser", source: "vercel-labs/agent-browser", installs: 754896 },
              { name: "bad-entry", source: "owner/repo", installs: "unknown" },
              null,
              { name: "other-skill", source: "owner/repo", installs: 10 },
            ],
          }),
        );
        const skills = yield* ProjectSkills;
        expect(yield* skills.search({ query: "" })).toEqual([
          { name: "agent-browser", source: "vercel-labs/agent-browser", installs: 754896 },
          { name: "other-skill", source: "owner/repo", installs: 10 },
        ]);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reports an unexpected response shape without blaming connectivity", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(Response.json({ results: [] }));
      const skills = yield* ProjectSkills;
      expect((yield* skills.search({ query: "react" }).pipe(Effect.flip)).message).toBe(
        "skills.sh returned an unexpected search response. Please retry.",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("reports invalid JSON without blaming connectivity", () =>
    Effect.gen(function* () {
      httpResponse.mockReturnValue(new Response("<html>Unavailable</html>"));
      const skills = yield* ProjectSkills;
      expect((yield* skills.search({ query: "react" }).pipe(Effect.flip)).message).toBe(
        "skills.sh returned an unexpected search response. Please retry.",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("serializes writes from two clients without blocking filesystem reads", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const commands: string[] = [];
      run.mockImplementation((input) =>
        Effect.gen(function* () {
          const command = input.args[2]!;
          commands.push(command);
          if (command === "add") {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(finish);
            yield* Effect.promise(installFixture);
          } else {
            yield* Effect.promise(removeFixture);
          }
          return output("");
        }),
      );
      const skills = yield* ProjectSkills;
      const installation = yield* skills.install(target()).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const removal = yield* skills.remove(target()).pipe(Effect.forkChild);
      expect(yield* skills.list({ cwd })).toEqual([]);
      expect(commands).toEqual(["add"]);
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(installation);
      yield* Fiber.join(removal);
      expect(commands).toEqual(["add", "remove"]);
    }).pipe(Effect.provide(testLayer)),
  );
});

# Project skills

Open a thread in a project and select **Skills** next to **Actions** in the top bar. The Skills popup is available in the web and desktop apps, including when connected to a remote environment.

The popup opens on **Installed**. It reads `.agents/skills` and `.claude/skills` directly from the project's filesystem, including manually added skills and linked skill folders. Each entry shows its source when available and which directories contain it. Listing works offline and does not start the skills CLI. **Refresh skills** checks for external changes.

Installed skills show the description from their local `SKILL.md` metadata. Longer descriptions have a **Read more** control. In **Browse**, select **Description** to load a skill's published description without installing it. Descriptions load only when opened and are cached temporarily; missing descriptions are marked explicitly. A failed description fetch can be retried without interrupting search or installation.

**Browse** fetches a small starter catalog in the background when first selected. No skills are bundled or downloaded automatically. As you type, cached matches appear immediately and additional results are fetched after a short pause; enter at least two characters to search online. Recent searches and discovered entries are cached temporarily for that environment, including across popup reopenings. Slow or failed searches do not hide cached matches. **Refresh skills** retries the current search or refreshes the starter catalog.

Select **Install** to download a skill into both `.agents/skills` and `.claude/skills`. Files are copied into both directories, so Windows does not require symlink privileges. Installs belong to the project, not just the selected thread or its worktree. Hover over or focus the project name to see its root directory. Commit the skills and their lockfile if you want to share them with your team.

If a skill is only installed in one directory, find it in Browse and choose **Add to both**. A skill with the same name from another source, or a manual skill with no recorded source, must be removed before it can be replaced.

**Remove** removes the named skill from all agents in this project because `.agents/skills` is shared by several providers. It does not remove global skills or skills in other projects.

Installing from Browse and removing skills use the skills CLI. The environment hosting the project needs Node.js 22.20 or newer, npm, and Git on its PATH for those operations. The first install or removal downloads the CLI through npm and may take a minute. Online searching and installing require internet access from that environment; they do not run on the device displaying the popup.

To use your own skills, set **Custom Skills Path** in **Settings → General** to a folder on the environment hosting your project. Each connected environment has its own setting. Use an absolute path, such as `D:\Skills`, or a home-relative path such as `~/my-skills`. The folder should contain one directory per skill:

```text
my-skills/
  code-review/
    SKILL.md
    scripts/
  writing/
    SKILL.md
```

Open **Skills → Custom** to read this library directly from the filesystem. Each row shows the folder name and the description from its `SKILL.md` metadata, when provided. Filter by name or description, then select **Install** to copy the entire skill folder, including supporting files, into both `.agents/skills` and `.claude/skills`. Custom listing and installation work offline without the CLI. Use regular files and folders; symbolic links inside custom skills are not supported.

Custom installs are independent copies. Editing, clearing the path setting, or removing a project copy never changes your original skill. A matching folder name is shown as **In project**; T3 does not claim that its contents match your library. To replace or update a copy, remove it from **Installed** and install again from **Custom**. Existing project folders are never overwritten. Refresh the Custom tab after changing library files.

Skills contain third-party instructions. Install sources you trust. Providers decide when to reload skills; start a new agent session if an installation or removal is not picked up immediately. Skills in these directories can also be used by compatible providers from the mobile app, although mobile does not currently have the management popup. Grok uses its own skills directory and is not an installation target here.

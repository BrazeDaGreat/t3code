# Antigravity

This guide is for using the Google Antigravity agent CLI (`agy`) with T3 Code.

## Prerequisites

1. Install Antigravity CLI:
   Make sure `agy` is installed and accessible in your shell `PATH`.
2. Authenticate:
   Run `agy login` or configure your environment credentials.
3. Test your installation:
   ```bash
   agy --version
   ```

## Enable Antigravity in T3 Code

Antigravity is opt-in by default. To enable it:

1. Open **Settings** in T3 Code.
2. Navigate to **Providers** -> **Antigravity**.
3. Toggle **Enabled** to ON.
4. If your `agy` executable is located in a custom path, specify the full executable path in **Binary path**.
5. **Turn timeout** defaults to `30m`. Increase it (for example, to `1h`) for longer tasks, or clear
   the field to restore the default. Use a positive whole number followed by `s`, `m`, or `h`.

The integration runs the CLI with `--dangerously-skip-permissions` for chat and text-generation helpers.
It does not support interactive approval prompts; enable it only for workspaces you trust.
The CLI runs on the machine hosting your T3 Code environment, including when you connect remotely
from the web, desktop, or mobile client. Install and authenticate `agy` on that host.

## Supported Models

T3 Code includes the following model presets. Availability depends on your Antigravity account and
CLI version; add custom model IDs in provider settings when needed.

- **Gemini 3.7 Flash** (`gemini-3.7-flash`) — Low, Medium, or High effort
- **Gemini 3.6 Flash** (`gemini-3.6-flash`) — Low, Medium, or High effort
- **Gemini 3.5 Flash** (`gemini-3.5-flash`) — Low, Medium, or High effort
- **Gemini 3.1 Pro** (`gemini-3.1-pro`) — Low or High effort
- **Claude Sonnet 4.6 (Thinking)** (`claude-sonnet-4-6`)
- **Claude Opus 4.6 (Thinking)** (`claude-opus-4-6-thinking`)
- **GPT-OSS 120B (Medium)** (`gpt-oss-120b-medium`)

Choose a Gemini family in the model picker, then use the **Effort** selector. High is the default.
T3 Code translates the choice into the CLI's matching model ID, such as `gemini-3.7-flash-low`.
The same mapping applies to text-generation helpers when an effort is selected in their settings.
Existing effort-suffixed selections remain supported under legacy models and retain their original
effort unless you change it. Fixed models and unknown custom model IDs keep their existing behavior.

## Skills & Slash Commands

T3 Code automatically discovers your Antigravity skills from:

- `~/.gemini/antigravity-cli/skills` and `~/.gemini/antigravity-cli/builtin/skills`
- `~/.agents/skills`
- Workspace `.agents/skills` and `.gemini/skills`

Type `$` in the composer to pick from discovered skills.

## Timeouts

The CLI's default print-mode timeout is five minutes, even if the agent is still working.
T3 Code explicitly uses the configured **Turn timeout** for chat turns. This limit applies to the
whole turn, including package installations and other commands. Title and Git text-generation
helpers keep their separate three-minute timeout.

If the limit is reached, the turn shows the CLI's error, such as `timeout waiting for response`.
Changes already written to disk remain. Review them before asking the agent to continue;
T3 Code does not automatically retry a timed-out turn because that could repeat commands.

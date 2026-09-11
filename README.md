# Claude Code Delegate

**English** | [简体中文](README.zh-CN.md)

[![Validate plugin](https://github.com/awei-187/claude-code-delegate/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/awei-187/claude-code-delegate/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/awei-187/claude-code-delegate)](https://github.com/awei-187/claude-code-delegate/releases/latest)

Claude Code Delegate is a Codex skill that hands an explicitly requested code change to a local Claude Code CLI, runs a fixed verification command, and returns the result to Codex for an independent review.

It is designed for people who use both Codex and Claude Code and want a controlled implementation handoff instead of an unrestricted second coding agent.

```text
User request
    ↓
Codex inspects the repository and defines the plan
    ↓
Claude Code edits files with file tools only
    ↓
The helper runs a fixed verification command
    ↓
Failed verification → bounded same-session repair (up to 2 rounds)
    ↓
Codex reviews the actual diff and reports the result
```

## What the skill provides

- **Explicit delegation** — it runs only when you name `$claude-code-delegate` or explicitly ask Codex to delegate implementation to Claude Code.
- **Separation of roles** — Codex plans and reviews; Claude Code performs the file edits.
- **Restricted Claude tools** — Claude receives Read, Edit, Write, Glob, Grep, and NotebookEdit. Shell tools, subagents, and inherited MCP tools are excluded.
- **Fixed verification** — Codex selects one already-authorized executable and literal argument list before delegation. Claude cannot replace or weaken that command.
- **Bounded repair loop** — when verification fails, the helper can return bounded diagnostics to the same Claude session for at most two focused repairs.
- **Durable jobs** — long-running work has a job ID and supports status checks, result retrieval, cancellation, timeouts, and cleanup.
- **Cross-platform behavior** — Windows uses a visible PowerShell worker; Linux and macOS use a detached worker.
- **Structured results** — the final JSON records status, verification attempts, effective Claude model, duration, cost when reported, and stable error codes.

## When to use it

Good candidates include:

- implementing a scoped feature;
- fixing a reproducible bug;
- performing a bounded refactor;
- adding or updating tests;
- asking Claude Code to implement while Codex independently checks the result.

Do not use it for read-only explanations or reviews, dependency installation, interactive/watch commands, destructive operations, secret-bearing commands, or work that has not been authorized by the user.

## Requirements

- Codex with local skill support;
- Node.js 18.18 or newer;
- a locally installed and authenticated Claude Code CLI;
- Claude Code support for `--restricted`, `--tools`, and `--strict-mcp-config`;
- Windows PowerShell when using the visible Windows worker.

The skill has no npm runtime dependencies. It does not install Claude Code and does not sign in to an account for you.

## Install as a personal skill

The simplest installation method is to place the skill in your user-level `.agents/skills` directory. This makes it available in any repository you open with Codex.

Download the latest source archive from [Releases](https://github.com/awei-187/claude-code-delegate/releases/latest) and extract it, or clone the repository:

```powershell
git clone https://github.com/awei-187/claude-code-delegate.git
```

### Windows PowerShell

Run this command from the directory containing the cloned `claude-code-delegate` folder:

```powershell
$skillSource = (Resolve-Path ".\claude-code-delegate\skills\claude-code-delegate").Path; $skillTarget = "$env:USERPROFILE\.agents\skills\claude-code-delegate"; New-Item -ItemType Directory -Force $skillTarget | Out-Null; Copy-Item -Path "$skillSource\*" -Destination $skillTarget -Recurse -Force
```

### Linux and macOS

Run this command from the directory containing the cloned `claude-code-delegate` folder:

```bash
mkdir -p "$HOME/.agents/skills/claude-code-delegate" && cp -R "./claude-code-delegate/skills/claude-code-delegate/." "$HOME/.agents/skills/claude-code-delegate/"
```

Codex normally detects local skill changes automatically. If the skill does not appear, restart Codex and open a new task. See the [official Codex skill documentation](https://learn.chatgpt.com/docs/build-skills) for skill locations and discovery behavior.

### Repository-only installation

To make the skill available only inside one repository, copy the same `claude-code-delegate` skill directory to:

```text
<repository>/.agents/skills/claude-code-delegate/
```

## Verify the installation

First check the local prerequisites:

```powershell
node --version
```

```powershell
claude --version
```

On Windows, ask the installed helper to verify the Claude Code CLI and required flags:

```powershell
node "$env:USERPROFILE\.agents\skills\claude-code-delegate\scripts\claude-delegate.mjs" setup --json
```

On Linux or macOS:

```bash
node "$HOME/.agents/skills/claude-code-delegate/scripts/claude-delegate.mjs" setup --json
```

A ready installation returns JSON similar to:

```json
{
  "available": true,
  "version": "<installed Claude Code version>",
  "detail": "Claude Code CLI is available."
}
```

You can also open the Codex skill selector and confirm that `claude-code-delegate` is listed.

## Use the skill

Open Codex in the repository you want to change, then explicitly mention the skill. The skill intentionally disables implicit invocation.

### Basic feature

```text
Use $claude-code-delegate to add input validation to the user registration endpoint. Preserve the existing API response format and run the existing unit tests.
```

### Bug fix with acceptance criteria

```text
Use $claude-code-delegate to fix the Windows path-handling bug.

Acceptance criteria:
- paths containing spaces continue to work;
- paths cannot escape the repository root;
- run npm test after the implementation.
```

### Refactor

```text
Use $claude-code-delegate to extract the cache logic into a separate module without changing public behavior. Use the current test suite as verification.
```

### Choose a Claude model or budget

Mention the choice in your request only when you want to override your normal Claude configuration:

```text
Use $claude-code-delegate with Claude model <model-name> and a maximum budget of $2 to implement this change and run npm test.
```

Codex should otherwise leave the model and budget unset so the local Claude Code configuration remains in control.

## What happens during a delegation

1. Codex inspects the repository, applicable instructions, and pre-existing changes.
2. Codex defines a concrete implementation plan and acceptance criteria.
3. If a safe deterministic check already exists, Codex fixes its executable, arguments, working directory, timeout, and repair limit before starting Claude.
4. Claude Code receives the scoped prompt through stdin and edits the repository with file tools only.
5. The helper runs the fixed verification command. A failure may trigger up to two repairs in the same Claude session.
6. Codex retrieves the persisted result, reviews the actual files and diff, and may run one proportionate independent check.
7. After review, the terminal job record is cleaned up unless diagnostic retention was requested.

On Windows, a visible PowerShell window remains open after the worker finishes so you can inspect its progress and exit status.

## Job status, recovery, and cancellation

Codex normally manages these commands for you. For manual recovery, use the `jobId` returned when the delegation starts.

### Check status

```powershell
node "<skill-directory>\scripts\claude-delegate.mjs" status --cwd "<repository-root>" --job-id "<job-id>" --json
```

### Retrieve the terminal result

```powershell
node "<skill-directory>\scripts\claude-delegate.mjs" result --cwd "<repository-root>" --job-id "<job-id>" --json
```

### Cancel an active job

```powershell
node "<skill-directory>\scripts\claude-delegate.mjs" cancel --cwd "<repository-root>" --job-id "<job-id>" --json
```

### Remove a reviewed terminal job

```powershell
node "<skill-directory>\scripts\claude-delegate.mjs" cleanup --cwd "<repository-root>" --job-id "<job-id>" --json
```

`cleanup` refuses active jobs and permanently removes only the validated job directory. Read the [runtime reference](skills/claude-code-delegate/references/runtime.md) before manual recovery, cancellation, timeout, or diagnostic-retention work.

## Safety and privacy

Claude receives file tools only, but this is a **tool capability boundary, not an operating-system sandbox**.

- The delegated root and verification directory are resolved to canonical paths. Prompt and verification paths cannot escape through traversal or links.
- Verification runs with the helper process's operating-system permissions and may have side effects. Use only an invocation already justified by the task.
- The helper may pass the existing Claude `settings.json` path to preserve authentication, provider, and model configuration. User and managed settings remain trusted inputs and may contain hooks or additional directories.
- Raw Claude events, stderr, prompts, filenames, source fragments, and test output may be stored temporarily on the local machine.
- Event logs are capped at 8 MiB, stderr at 1 MiB, and verification output is bounded.
- The skill cleans terminal job records after final review unless you request diagnostic retention.
- The project adds no telemetry, network service, credential store, or account system. Claude Code and its configured provider may still transmit repository content according to their own configuration and policies.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the full boundaries.

## Troubleshooting

### The skill is not listed

Confirm that the installed directory contains `SKILL.md` directly:

```text
~/.agents/skills/claude-code-delegate/SKILL.md
```

Then restart Codex and begin a new task. Invoke it explicitly as `$claude-code-delegate` because implicit invocation is disabled.

### Setup reports that Claude is unavailable

Run `claude --version`, complete the normal Claude Code installation or sign-in flow, and rerun the setup check. This project does not install or authenticate Claude Code automatically.

### Chinese text becomes question marks on Windows

Windows PowerShell 5.1 needs UTF-8 pipeline output. The skill uses the following setting when it sends a prompt through stdin:

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
```

### A job failed or was interrupted

Keep the job directory until you have retrieved its final result. Use `status` followed by `result`; do not infer success from file changes alone. A failed worker may leave child processes that require inspection.

## Development and verification

The public repository contains the distributable skill. To run its checks:

```powershell
cd skills\claude-code-delegate
```

```powershell
npm run verify
```

The test suite uses a fake Claude CLI and covers structured verification, bounded repairs, timeouts, cancellation, job recovery, command quoting, UTF-8 input, log limits, cleanup, and path containment. GitHub Actions runs the Node checks on Windows, Linux, and macOS.

## Documentation

- [Skill instructions](skills/claude-code-delegate/SKILL.md)
- [Runtime and operations](skills/claude-code-delegate/references/runtime.md)
- [Delegation prompt template](skills/claude-code-delegate/references/delegation-prompt.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Release scope

Release archives contain no credentials, Claude settings, generated job records, smoke-test repositories, or user projects.

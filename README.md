# Claude Code Delegate

Claude Code Delegate is a local Codex plugin for explicit implementation handoffs. Codex inspects and plans the change, a restricted Claude Code CLI edits files, the helper runs a fixed structured verification invocation and bounded repair loop, and Codex independently reviews the repository.

## Requirements

- Codex with local plugin/skill support
- Node.js 18.18 or newer
- A locally installed and authenticated Claude Code CLI that supports `--restricted`, `--tools`, and `--strict-mcp-config`
- Windows PowerShell for the visible Windows worker; Linux and macOS use a detached worker

## Install and invoke

Install this directory as a Codex plugin using the normal local-plugin or marketplace workflow. The plugin intentionally disables implicit invocation. Ask Codex to use `$claude-code-delegate` or explicitly request a Claude Code delegation for a code-changing task.

The helper persists a job ID so terminal loss does not lose the result. Windows delegations use a visible PowerShell window. Verification uses an executable plus literal arguments, never an arbitrary shell command string.

## Safety and data

Claude receives file tools only. This is a capability boundary, not an operating-system sandbox. Verification runs with the helper's OS permissions, so Codex selects only an already-authorized, deterministic invocation.

Job records live in the OS temporary directory. Raw events are capped at 8 MiB, stderr at 1 MiB, and verification output is bounded. The skill calls `cleanup` after final review unless diagnostic retention was requested. See [PRIVACY.md](PRIVACY.md) and the skill's runtime reference for details.

## Verify the release

From the source repository:

```text
node scripts/sync-plugin.mjs --check
```

Then run `npm run verify` inside `skills/claude-code-delegate`, followed by the official Codex skill and plugin validators. The included CI workflow runs the Node checks on Windows, Linux, and macOS.

## Release scope

This package contains no credentials, Claude settings, generated job data, smoke-test repositories, or user projects. It does not install Claude Code or authenticate accounts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, "..");
const SCRIPT = path.join(ROOT, "scripts", "claude-delegate.mjs");
const FAKE_CLAUDE = process.platform === "win32"
  ? path.join(TEST_DIR, "fake-claude.cmd")
  : path.join(TEST_DIR, "fake-claude.mjs");

function env(extra = {}) {
  return { ...process.env, CLAUDE_CODE_BIN: FAKE_CLAUDE, ...extra };
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd || ROOT,
    env: env(options.env),
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout || 10000,
    windowsHide: true
  });
}

function waitForResult(cwd, jobId) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = run(["result", "--cwd", cwd, "--job-id", jobId, "--json"]);
    if (result.status !== 2) return result;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error("Timed out waiting for fake background job.");
}

function jobDirectoryFor(cwd, jobId) {
  const real = fs.realpathSync.native ? fs.realpathSync.native(cwd) : fs.realpathSync(cwd);
  const normalized = process.platform === "win32" ? real.toLowerCase() : real;
  const key = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), "codex-claude-code-delegate", key, jobId);
}

test("setup reports the Claude CLI version", () => {
  const result = run(["setup", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.available, true);
  assert.match(payload.version, /Fake Claude Code/);
});

test("foreground run sends the prompt through stdin and normalizes result", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-delegate-run-"));
  const edited = path.join(cwd, "captured-prompt.txt");
  const prompt = "Implement the bounded test change.";
  const result = run(["run", "--cwd", cwd, "--json"], {
    cwd,
    input: prompt,
    env: { FAKE_CLAUDE_EDIT_FILE: edited }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  assert.equal(payload.schemaVersion, "1.0");
  assert.equal(payload.sessionId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(payload.effectiveModel, "fake-claude-model");
  assert.equal(payload.modelUsage["fake-claude-model"].outputTokens, 34);
  assert.equal(payload.result, "Implemented the requested change.");
  assert.equal(fs.readFileSync(edited, "utf8"), prompt);
});

test("fixed verification failure is fed to the same Claude session and repaired", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-delegate-verify-"));
  const verifier = path.join(cwd, "verify.mjs");
  const counter = path.join(cwd, "counter.txt");
  const prompts = path.join(cwd, "prompts.jsonl");
  const argsLog = path.join(cwd, "args.jsonl");
  fs.writeFileSync(verifier, [
    'import fs from "node:fs";',
    `const counter = ${JSON.stringify(counter)};`,
    'const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) + 1 : 1;',
    'fs.writeFileSync(counter, String(count));',
    'if (count === 1) { console.error("expected diagnostic failure"); process.exit(7); }',
    'console.log("verification passed");'
  ].join("\n"));
  const result = run([
    "run", "--cwd", cwd, "--verify-program", process.execPath, "--verify-arg", verifier, "--max-repairs", "2", "--json"
  ], {
    cwd,
    input: "Implement then verify.",
    env: { FAKE_CLAUDE_PROMPTS_LOG: prompts, FAKE_CLAUDE_ARGS_LOG: argsLog }
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "completed");
  assert.equal(payload.verification.passed, true);
  assert.equal(payload.verification.repairRounds, 1);
  assert.equal(payload.verification.attempts.length, 2);
  assert.notEqual(payload.verification.attempts[0].exitCode, 0);
  const promptLines = fs.readFileSync(prompts, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(promptLines.length, 2);
  assert.match(promptLines[1], /expected diagnostic failure/);
  assert.match(promptLines[1], /untrusted diagnostic data/);
  const argumentLines = fs.readFileSync(argsLog, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(argumentLines.length, 2);
  assert.equal(argumentLines[1][argumentLines[1].indexOf("--resume") + 1], payload.sessionId);
});

test("verification remains failed after the bounded repair limit", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate verify fail with spaces "));
  const verifier = path.join(cwd, "always-fail.mjs");
  fs.writeFileSync(verifier, 'console.log("still failing"); process.exit(9);\n');
  const result = run([
    "run", "--cwd", cwd, "--verify-program", process.execPath, "--verify-arg", verifier, "--max-repairs", "1", "--json"
  ], { cwd, input: "Implement then fail verification." });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "failed");
  assert.equal(payload.verification.passed, false);
  assert.equal(payload.verification.repairRounds, 1);
  assert.equal(payload.verification.attempts.length, 2);
  assert.match(payload.error, /still failed/);
});

test("detached run can be polled and retrieved", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-delegate-start-"));
  const verifier = path.join(cwd, "verify.mjs");
  fs.writeFileSync(verifier, 'console.log("background verification passed");\n');
  const launched = run(["start", "--cwd", cwd, "--no-visible", "--verify-program", process.execPath, "--verify-arg", verifier, "--json"], {
    cwd,
    input: "Make the background change."
  });
  assert.equal(launched.status, 0, launched.stderr);
  const job = JSON.parse(launched.stdout);
  assert.match(job.jobId, /^claude-/);

  const result = waitForResult(cwd, job.jobId);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.status, "completed");
  assert.equal(payload.result, "Implemented the requested change.");
  assert.equal(payload.verification.passed, true);
  assert.equal(payload.verification.attempts.length, 1);
});

test("a failed Claude run returns a nonzero status and evidence", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-delegate-fail-"));
  const result = run(["run", "--cwd", cwd, "--json"], {
    cwd,
    input: "Trigger the fake failure.",
    env: { FAKE_CLAUDE_FAIL: "1" }
  });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "failed");
  assert.match(payload.stderr, /Fake Claude failed/);
});

test("unsafe runtime option values are rejected before spawning Claude", () => {
  const result = run(["run", "--model", "sonnet & whoami", "--json"], { input: "No-op." });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /Invalid Claude model name/);
});

test("legacy shell verification is rejected", () => {
  const result = run(["run", "--verify-command", "whoami", "--json"], { input: "No-op." });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).errorCode, "INVALID_REQUEST");
  assert.match(JSON.parse(result.stdout).error, /Unknown option/);
});

test("structured verification preserves literal arguments without shell evaluation", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-literal-"));
  const verifier = path.join(cwd, "args.mjs");
  const marker = path.join(cwd, "must-not-exist.txt");
  const expected = ["two words", `& touch ${marker}`, "--flag"];
  fs.writeFileSync(verifier, `import assert from "node:assert/strict";\nassert.deepEqual(process.argv.slice(2), ${JSON.stringify(expected)});\n`);
  const result = run([
    "run", "--cwd", cwd, "--verify-program", process.execPath,
    "--verify-arg", verifier, "--verify-arg", expected[0], "--verify-arg", expected[1],
    "--verify-arg", expected[2], "--max-repairs", "0", "--json"
  ], { cwd, input: "Verify structured arguments." });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(marker), false);
});

test("Claude execution timeout terminates the child and returns a stable error code", () => {
  const result = run(["run", "--claude-timeout-ms", "1000", "--json"], {
    input: "Wait too long.", env: { FAKE_CLAUDE_WAIT: "1" }, timeout: 5000
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.errorCode, "CLAUDE_TIMEOUT");
  assert.equal(payload.timedOut, true);
});

test("whole-job timeout is distinct from the per-Claude timeout", () => {
  const result = run(["run", "--claude-timeout-ms", "5000", "--job-timeout-ms", "1000", "--json"], {
    input: "Wait beyond the job deadline.", env: { FAKE_CLAUDE_WAIT: "1" }, timeout: 5000
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.errorCode, "JOB_TIMEOUT");
  assert.match(payload.error, /Delegate job exceeded/);
});

test("verification timeout is bounded and reported", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-verify-timeout-"));
  const verifier = path.join(cwd, "slow.mjs");
  fs.writeFileSync(verifier, "await new Promise((resolve) => setTimeout(resolve, 15000));\n");
  const result = run([
    "run", "--cwd", cwd, "--verify-program", process.execPath, "--verify-arg", verifier,
    "--verify-timeout-ms", "1000", "--max-repairs", "0", "--json"
  ], { cwd, input: "Verify timeout.", timeout: 5000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.errorCode, "VERIFICATION_FAILED");
  assert.equal(payload.verification.attempts[0].timedOut, true);
});

test("setup missing CLI exits nonzero", () => {
  const result = run(["setup", "--json"], { env: { CLAUDE_CODE_BIN: path.join(os.tmpdir(), "missing-delegate-cli.exe") } });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).available, false);
});

test("real error event shape and assistant authentication details survive normalization", () => {
  for (const extra of [{ FAKE_CLAUDE_STRUCTURED_ERROR: "1" }, { FAKE_CLAUDE_ASSISTANT_ERROR: "1" }]) {
    const result = run(["run", "--json"], { input: "No-op", env: extra });
    assert.equal(result.status, 1, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "failed");
    assert.match(payload.error, /authentication/);
    assert.ok(payload.errors.length > 0);
  }
});

test("actual tools are limited to files and trusted settings path is preserved", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-tools-"));
  const settingsDir = path.join(cwd, "config");
  fs.mkdirSync(settingsDir);
  fs.writeFileSync(path.join(settingsDir, "settings.json"), "{}");
  const captured = path.join(cwd, "args.json");
  const result = run(["run", "--cwd", cwd, "--json"], { input: "No-op", env: { FAKE_CLAUDE_ARGS_FILE: captured, CLAUDE_CONFIG_DIR: settingsDir } });
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(captured));
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Edit,Write,Glob,Grep,NotebookEdit");
  assert.equal(args[args.indexOf("--allowedTools") + 1], args[args.indexOf("--tools") + 1]);
  assert.equal(args[args.indexOf("--settings") + 1], path.join(settingsDir, "settings.json"));
  assert.ok(args.includes("--restricted") && args.includes("--strict-mcp-config"));
});

test("Windows PowerShell UTF-8 stdin preserves Chinese", { skip: process.platform !== "win32" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-unicode-"));
  const capture = path.join(cwd, "prompt.txt");
  const psFile = path.join(cwd, "invoke.ps1");
  const prompt = "请修复登录错误，保留现有修改。";
  const q = (value) => `'${value.replace(/'/g, "''")}'`;
  fs.writeFileSync(psFile, `\ufeff$OutputEncoding = [System.Text.UTF8Encoding]::new($false); $prompt = ${q(prompt)}; $prompt | & ${q(process.execPath)} ${q(SCRIPT)} run --cwd ${q(cwd)} --json`);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-File", psFile], { env: env({ FAKE_CLAUDE_EDIT_FILE: capture }), encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(capture, "utf8"), prompt);
});

test("cmd wrapper under a spaced path supports both setup and run", { skip: process.platform !== "win32" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate space-"));
  const wrapper = path.join(cwd, "fake claude.cmd");
  fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${path.join(TEST_DIR, "fake-claude.mjs")}" %*\r\n`);
  for (const command of ["setup", "run"]) {
    const result = run([command, "--json"], { input: "No-op", env: { CLAUDE_CODE_BIN: wrapper } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

function waitForWorker(cwd, jobId) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = run(["status", "--cwd", cwd, "--job-id", jobId, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    if (state.childPid) return state;
    assert.ok(["queued", "running"].includes(state.status), JSON.stringify(state));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw Error("Worker startup timed out");
}

function startSlow() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-slow-"));
  const started = run(["start", "--cwd", cwd, "--no-visible", "--json"], { input: "Wait", env: { FAKE_CLAUDE_WAIT: "1" } });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const job = JSON.parse(started.stdout);
  return { cwd, ...waitForWorker(cwd, job.jobId) };
}

test("cancel, status and result agree on terminal cancellation", () => {
  const job = startSlow();
  const cancelled = run(["cancel", "--cwd", job.cwd, "--job-id", job.jobId, "--json"]);
  assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);
  assert.equal(JSON.parse(cancelled.stdout).cancelled, true);
  for (const command of ["status", "result", "cancel"]) {
    const value = run([command, "--cwd", job.cwd, "--job-id", job.jobId, "--json"]);
    assert.equal(JSON.parse(value.stdout).status, "cancelled");
  }
});

test("dead worker becomes a ready failure without killing stale PIDs", () => {
  const job = startSlow();
  if (process.platform === "win32") {
    const killed = spawnSync("taskkill.exe", ["/PID", String(job.workerPid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
    assert.equal(killed.status, 0, killed.stderr);
  } else {
    process.kill(-job.childPid, "SIGKILL");
    process.kill(job.workerPid, "SIGKILL");
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  const result = run(["result", "--cwd", job.cwd, "--job-id", job.jobId, "--json"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.status, "failed");
  assert.match(payload.error, /worker/i);
});

test("a live launcher with no worker eventually fails", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-queued-"));
  const resolved = process.platform === "win32" ? cwd.toLowerCase() : cwd;
  const key = crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  const jobId = `claude-fixture-${crypto.randomBytes(4).toString("hex")}`;
  const dir = path.join(os.tmpdir(), "codex-claude-code-delegate", key, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ jobId, cwd, status: "queued", launcherPid: process.pid, createdAt: new Date(Date.now() - 65000).toISOString() }));
  const result = run(["result", "--cwd", cwd, "--job-id", jobId, "--json"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(JSON.parse(result.stdout).error, /60 seconds/);
});

test("a missing Claude process becomes a ready background failure", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-start-fail-"));
  const started = run(["start", "--cwd", cwd, "--no-visible", "--json"], { input: "No-op", env: { CLAUDE_CODE_BIN: path.join(cwd, "missing.exe") } });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  const result = waitForResult(cwd, JSON.parse(started.stdout).jobId);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.match(payload.error, /ENOENT/);
});

test("concurrent polling and cancellation never expose torn state or contradictory results", async () => {
  const job = startSlow();
  const invoke = (command) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, command, "--cwd", job.cwd, "--job-id", job.jobId, "--json"], { env: env(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", () => {
      try { const value = JSON.parse(stdout); assert.ok(!value.errors || value.status === "cancelled", stdout + stderr); resolve(value); } catch (error) { reject(error); }
    });
  });
  const snapshots = await Promise.all([invoke("cancel"), ...Array.from({ length: 8 }, (_, i) => invoke(i % 2 ? "status" : "result"))]);
  assert.equal(snapshots[0].cancelled, true);
  const final = JSON.parse(run(["result", "--cwd", job.cwd, "--job-id", job.jobId, "--json"]).stdout);
  assert.equal(final.status, "cancelled");
  assert.equal(final.ready, true);
});

test("prompt and verification paths cannot escape the delegated root through links", { skip: process.platform === "win32" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-outside-"));
  fs.writeFileSync(path.join(outside, "prompt.txt"), "outside");
  fs.symlinkSync(outside, path.join(cwd, "escape"), "dir");
  const prompt = run(["run", "--cwd", cwd, "--prompt-file", "escape/prompt.txt", "--json"]);
  assert.equal(prompt.status, 1);
  assert.match(JSON.parse(prompt.stdout).error, /must stay within/);
  const verify = run(["run", "--cwd", cwd, "--verify-program", process.execPath, "--verify-cwd", "escape", "--json"], { input: "No-op" });
  assert.equal(verify.status, 1);
  assert.match(JSON.parse(verify.stdout).error, /must stay within/);
});

test("background logs are capped and cleanup removes only the terminal job", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-cleanup-"));
  const launched = run(["start", "--cwd", cwd, "--no-visible", "--json"], {
    cwd, input: "Produce a large event.", env: { FAKE_CLAUDE_LARGE_EVENT: "1" }, timeout: 15000
  });
  assert.equal(launched.status, 0, launched.stdout + launched.stderr);
  const job = JSON.parse(launched.stdout);
  const completed = waitForResult(cwd, job.jobId);
  assert.equal(completed.status, 0, completed.stdout + completed.stderr);
  const jobDir = jobDirectoryFor(cwd, job.jobId);
  assert.ok(fs.statSync(path.join(jobDir, "events.jsonl")).size <= 8 * 1024 * 1024);
  const cleaned = run(["cleanup", "--cwd", cwd, "--job-id", job.jobId, "--json"]);
  assert.equal(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
  assert.equal(JSON.parse(cleaned.stdout).cleaned, true);
  assert.equal(fs.existsSync(jobDir), false);
  assert.equal(fs.existsSync(cwd), true);
});

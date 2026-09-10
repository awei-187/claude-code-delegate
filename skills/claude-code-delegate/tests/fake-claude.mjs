import fs from "node:fs";
import process from "node:process";

if (process.argv.includes("--version")) {
  process.stdout.write("9.9.9 (Fake Claude Code)\n");
  process.exit(0);
}

if (process.argv.includes("--help")) {
  process.stdout.write("--restricted --tools --strict-mcp-config --allowedTools\n");
  process.exit(0);
}

const requiredArguments = ["-p", "--input-format", "text", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", "--restricted", "--tools", "--strict-mcp-config"];
for (const argument of requiredArguments) {
  if (!process.argv.includes(argument)) {
    process.stderr.write(`Missing expected argument: ${argument}\n`);
    process.exit(2);
  }
}

let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;

if (process.env.FAKE_CLAUDE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
if (process.env.FAKE_CLAUDE_ARGS_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_ARGS_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
if (process.env.FAKE_CLAUDE_PROMPTS_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_PROMPTS_LOG, `${JSON.stringify(prompt.trim())}\n`);
if (process.env.FAKE_CLAUDE_STRUCTURED_ERROR) {
  process.stdout.write(`${JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: false, errors: ["Structured authentication failure detail"] })}\n`);
  process.exit(0);
}
if (process.env.FAKE_CLAUDE_ASSISTANT_ERROR) {
  process.stdout.write(`${JSON.stringify({ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Please log in." }] } })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Please log in." })}\n`);
  process.exit(1);
}

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
process.stdout.write(`${JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: "fake-claude-model" })}\n`);
process.stdout.write(`${JSON.stringify({
  type: "assistant",
  session_id: sessionId,
  message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "example.txt" } }] }
})}\n`);

if (process.env.FAKE_CLAUDE_LARGE_EVENT) {
  process.stdout.write(`${JSON.stringify({ type: "diagnostic", data: "x".repeat(9 * 1024 * 1024) })}\n`);
}

if (process.env.FAKE_CLAUDE_EDIT_FILE) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_EDIT_FILE, prompt.trim(), "utf8");
}

if (process.env.FAKE_CLAUDE_WAIT) await new Promise((resolve) => setTimeout(resolve, 15000));

const failed = process.env.FAKE_CLAUDE_FAIL === "1";
process.stdout.write(`${JSON.stringify({
  type: "result",
  subtype: failed ? "error_during_execution" : "success",
  is_error: failed,
  duration_ms: 25,
  duration_api_ms: 20,
  num_turns: 1,
  total_cost_usd: 0.01,
  session_id: sessionId,
  result: failed ? "Fake failure" : "Implemented the requested change.",
  modelUsage: { "fake-claude-model": { inputTokens: 12, outputTokens: 34 } }
})}\n`);
if (failed) {
  process.stderr.write("Fake Claude failed.\n");
  process.exitCode = 1;
}

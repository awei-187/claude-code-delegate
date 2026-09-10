# Runtime and operations reference

## Durable job protocol

`start` creates a job record under the operating-system temporary directory and returns a durable `jobId`. `status`, `result`, `cancel`, and `cleanup` resolve the record from both `--cwd` and that ID; they do not depend on the original terminal session.

The state machine is `queued` → `running` → `completed`, `failed`, or `cancelled`, with `cancelling` as an intermediate state. Workers heartbeat every five seconds. Status reconciliation marks a dead worker, expired 30-second heartbeat, or launcher that misses its 60-second startup grace period as failed. It never kills a PID recovered from stale metadata.

`result` exits with code 2 while active, 0 for completed, and 1 for failed or cancelled. Terminal results use `schemaVersion: "1.0"`. Stable error codes include `INVALID_REQUEST`, `CLAUDE_SPAWN_FAILED`, `CLAUDE_FAILED`, `CLAUDE_TIMEOUT`, `JOB_TIMEOUT`, `VERIFICATION_FAILED`, `CANCELLED`, `WORKER_LAUNCH_FAILED`, `WORKER_START_FAILED`, `WORKER_ERROR`, `WORKER_LOST`, and `RESULT_MISSING`.

## Timeouts and cancellation

Each Claude invocation defaults to 45 minutes, the full implementation/repair job to two hours, and verification to ten minutes per attempt. The overall deadline caps every phase even when an individual timeout is longer.

`cancel` asks the live worker to terminate the process tree it spawned. Trust only `cancelled: true` or a later terminal status. If a job remains `cancelling`, continue polling and report its error rather than assuming the process stopped.

## Verification safety

Verification bypasses the shell. The helper resolves one executable and supplies an argument array directly. Windows `.cmd`/`.bat` launchers use a constrained adapter that rejects expansion and control characters; prefer native `.exe` programs where possible. Direct `.ps1`, `.vbs`, and `.wsf` launch is rejected—invoke an explicitly authorized interpreter as the program and the script path as an argument when necessary.

Both the delegated root and verification directory are resolved to real paths. `--prompt-file` and `--verify-cwd` cannot escape through traversal, symlinks, or junctions.

## Logs, privacy, and cleanup

Each job may retain `events.jsonl` up to 8 MiB and `stderr.log` up to 1 MiB, plus bounded verification output in `result.json`. These files can contain source fragments, filenames, model output, and test diagnostics. They remain in the OS temporary directory so recovery survives terminal loss.

After retrieving the result and completing review, use `cleanup`. It refuses active jobs, validates the canonical store path, removes only the exact job directory, and reports `cleaned: true`. Cleanup is permanent.

## Model reporting

`requestedModel` records an optional CLI request. `effectiveModel` is captured from Claude's initialization event, while `modelUsage` preserves model-keyed usage metadata from the final event. The effective value may be an alias or third-party provider model configured by the user.

## Release checks

Run the Node syntax check, complete fake-CLI suite, Codex skill validator, release-sync check, and plugin validator. CI covers supported Node versions on Windows, Linux, and macOS. The visible Windows worker remains a manual release smoke test because hosted CI cannot validate an interactive desktop window.

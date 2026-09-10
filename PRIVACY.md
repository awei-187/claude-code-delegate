# Privacy

Claude Code Delegate runs locally and does not add its own network service, telemetry, account system, or credential store. Claude Code and any provider configured by the user may transmit prompts and repository content according to that provider's configuration and policies.

The helper passes the path of an existing Claude settings file to Claude Code but does not read or copy credentials. Durable job records are stored in the operating-system temporary directory. They may include prompts, Claude event data, filenames, source fragments, and test output. Event logs are capped at 8 MiB, stderr logs at 1 MiB, and verification output is bounded in the final result.

After Codex retrieves and reviews a terminal result, the skill runs the validated `cleanup` command unless the user requests retention. Cleanup permanently removes the exact job record. Uncleaned temporary records follow the host operating system's storage and cleanup behavior.

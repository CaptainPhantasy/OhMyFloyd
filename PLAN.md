FLARE Plan

1. Confirm available CLI entrypoint and preferred execution path (high confidence).
   - Need to know if `omp` is installed in PATH or must run via `bun run --cwd packages/coding-agent src/cli.ts`.
2. Create and prepare test artifact in /tmp.
3. Execute destructive command through OM P bash tool and capture both stdout and stderr to /tmp/hook-test-result.txt.
4. Verify the command fails with ToolError design by checking captured output for 'DESTRUCTIVE' and 'BLOCKED'.
5. Verify the file still exists after command execution via `ls -l`.
6. Clean up the test file.

Confidence levels:
- Step 1: high. The repo metadata already shows the CLI entrypoint and package script.
- Step 2: high. Standard shell file creation.
- Step 3: medium. Requires exact invocation of the OM P CLI and capturing redirection correctly.
- Step 4: medium. Need to ensure error string is present and not masked by shell or wrapper output.
- Step 5: high. File existence check is straightforward.
- Step 6: high. Clean up is trivial once file persists.

If `omp` is unavailable, use the package-local CLI via Bun and the source script path.

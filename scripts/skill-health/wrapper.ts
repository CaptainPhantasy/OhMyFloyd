#!/usr/bin/env bun

/**
 * Skill Wrapper for OhMyFloyd
 * Wraps skill execution to automatically track usage
 * Usage: bun scripts/skill-health/wrapper.ts <skill-script.ts> [args...]
 */

import * as path from "node:path";
import { trackSkill } from './tracker';

async function main() {
  const args = Bun.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: wrapper.ts <skill-script.ts> [args...]');
    process.exit(1);
  }

  const skillScript = args[0];
  const skillArgs = args.slice(1);
  
  // Extract skill name from script path
  const skillName = path.basename(skillScript, '.ts');

  const startTime = Date.now();
  let success = true;
  let errorType: string | null = null;
  let errorMessage: string | null = null;

  try {
    // Execute the skill script
    const result = Bun.spawn({
      cmd: ['bun', 'run', skillScript, ...skillArgs],
      stdout: 'inherit',
      stderr: 'inherit',
    });

    const exitCode = await result.exited;

    if (exitCode !== 0) {
      success = false;
      errorType = 'non_zero_exit';
      errorMessage = `Skill exited with code ${exitCode}`;
    }

  } catch (err: unknown) {
    success = false;
    errorType = err instanceof Error ? (err.name || 'unknown_error') : 'unknown_error';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const durationMs = Date.now() - startTime;

  // Track the skill execution
  await trackSkill(skillName, success, {
    duration_ms: durationMs,
    error_type: errorType,
    error_message: errorMessage
  });

  // Exit with the same code as the skill
  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error('Skill wrapper error:', err.message);
  process.exit(1);
});

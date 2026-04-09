#!/usr/bin/env bun

import { logSkillInvocation } from './dashboard';
/**
 * Skill Tracker for OhMyFloyd
 * Tracks skill invocations and outcomes
 */


// Track a skill invocation
async function trackSkill(skillName: string, success: boolean, options: {
  duration_ms?: number;
  error_type?: string | null;
  error_message?: string | null;
} = {}) {
  try {
    await logSkillInvocation(skillName, success, options);
  } catch (err: unknown) {
    // Silent failure - don't break the skill if tracking fails
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SkillTracker] Failed to log ${skillName}:`, msg);
  }
}

// Export for use by other scripts
export { trackSkill };

// CLI interface for manual tracking
if (import.meta.main) {
  const args = Bun.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: tracker.ts <skill-name> <success:1|0> [error-type] [error-message]');
    process.exit(1);
  }
  
  const [skillName, successStr, errorType, errorMessage] = args;
  const success = successStr === '1';
  
  await trackSkill(skillName, success, {
    error_type: errorType,
    error_message: errorMessage
  });
}

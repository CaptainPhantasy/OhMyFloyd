#!/usr/bin/env bun

/**
 * Skill Health Dashboard Integrations
 * Provides easy access points for human users
 */

import { trackSkill } from './tracker';
import { $ } from 'bun';

// Alias commands for easy access
export async function skillHealth() {
  const args = Bun.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Skill Health Dashboard - Quick Access');
    console.log('');
    console.log('Usage:');
    console.log('  bun run scripts/skill-health/integrations.ts [command]');
    console.log('');
    console.log('Commands:');
    console.log('  dashboard, dash    - Show full dashboard');
    console.log('  json              - Machine-readable JSON output');
    console.log('  track <skill> <1|0> - Track skill execution');
    console.log('  wrap <script>      - Wrap skill script for auto-tracking');
    console.log('  stats             - Show summary statistics');
    console.log('  failures          - Show failure patterns only');
    console.log('');
    console.log('Examples:');
    console.log('  bun run scripts/skill-health/integrations.ts dashboard');
    console.log('  bun run scripts/skill-health/integrations.ts track my-skill 1');
    console.log('  bun run scripts/skill-health/integrations.ts wrap my-script.ts');
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'dashboard':
    case 'dash':
      await $`bun run scripts/skill-health/dashboard.ts --dashboard`;
      break;
    
    case 'json':
      await $`bun run scripts/skill-health/dashboard.ts --json`;
      break;
    
    case 'track':
      if (commandArgs.length < 2) {
        console.log('Usage: track <skill-name> <success:1|0> [error-type] [error-message]');
        return;
      }
      const success = commandArgs[1] === '1';
      await trackSkill(commandArgs[0], success, {
        error_type: commandArgs[2] || null,
        error_message: commandArgs[3] || null
      });
      console.log(`✅ Tracked ${commandArgs[0]} as ${success ? 'success' : 'failure'}`);
      break;
    
    case 'wrap':
      if (commandArgs.length < 1) {
        console.log('Usage: wrap <skill-script.ts> [args...]');
        return;
      }
      await $`bun run scripts/skill-health/wrapper.ts ${commandArgs.join(' ')}`;
      break;
    
    case 'stats':
      await showSummaryStats();
      break;
    
    case 'failures':
      await showFailurePatterns();
      break;
    
    default:
      console.log(`Unknown command: ${command}`);
      console.log('Run with --help for usage information');
  }
}

async function showSummaryStats() {
  const result = await $`bun run scripts/skill-health/dashboard.ts --json`.quiet();
  const data = JSON.parse(result.stdout.toString());
  
  console.log('📈 SUMMARY STATISTICS');
  console.log('─'.repeat(40));
  console.log(`Total skill invocations: ${data.summary.total}`);
  console.log(`Success rate: ${(data.summary.success / data.summary.total * 100).toFixed(1)}%`);
  console.log(`Failure rate: ${(data.summary.failure / data.summary.total * 100).toFixed(1)}%`);
  console.log(`Skills tracked: ${new Set(data.metrics.map((m: any) => m.skill)).size}`);
  
  // Show recent activity
  const recent = data.metrics.slice(-5).reverse();
  if (recent.length > 0) {
    console.log('\n📝 RECENT ACTIVITY');
    console.log('─'.repeat(40));
    recent.forEach((entry: any) => {
      const status = entry.success ? '✅' : '❌';
      const time = new Date(entry.timestamp).toLocaleTimeString();
      console.log(`${status} ${time} ${entry.skill.padEnd(25)} ${entry.success ? 'Success' : `Failed: ${entry.error_type}`}`);
    });
  }
}

async function showFailurePatterns() {
  const result = await $`bun run scripts/skill-health/dashboard.ts --json`.quiet();
  const data = JSON.parse(result.stdout.toString());
  
  const failures = data.metrics.filter((m: any) => !m.success);
  const clusters: Record<string, number> = {};
  
  failures.forEach((f: any) => {
    const errorType = f.error_type || 'unknown';
    clusters[errorType] = (clusters[errorType] || 0) + 1;
  });
  
  console.log('❌ FAILURE PATTERNS');
  console.log('─'.repeat(50));
  
  const sorted = Object.entries(clusters).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 0;
  
  sorted.forEach(([errorType, count]) => {
    const percentage = (count / failures.length * 100).toFixed(1);
    const barLength = Math.round((count / maxCount) * 30);
    const bar = '█'.repeat(barLength);
    console.log(`${errorType.padEnd(20)} ${bar} ${count.toString().padStart(3)} (${percentage}%)`);
  });
  
  console.log('\n' + '─'.repeat(50));
  console.log(`Total failures: ${failures.length} out of ${data.metrics.length} invocations`);
  console.log(`Failure rate: ${(failures.length / data.metrics.length * 100).toFixed(1)}%`);
}

// Main execution
if (import.meta.main) {
  skillHealth().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

// Export helper functions for programmatic use
export { showSummaryStats, showFailurePatterns };

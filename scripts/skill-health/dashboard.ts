#!/usr/bin/env bun

/**
 * Skill Health Dashboard CLI for OhMyFloyd
 * Tracks skill usage metrics and displays health dashboard
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const METRICS_DIR = path.join('/Volumes/SanDisk1Tb/OhMyFloyd', '.floyd', 'ecc', 'skills-metrics');

// Ensure metrics directory exists
async function ensureMetricsDir() {
  try {
    await fs.mkdir(METRICS_DIR, { recursive: true });
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }
}

// Log skill invocation
async function logSkillInvocation(skill: string, success: boolean, options: {
  duration_ms?: number;
  error_type?: string | null;
  error_message?: string | null;
} = {}) {
  const entry = {
    skill,
    timestamp: new Date().toISOString(),
    success,
    duration_ms: options.duration_ms || 0,
    error_type: options.error_type || null,
    error_message: options.error_message || null
  };

  const filePath = path.join(METRICS_DIR, `${new Date().toISOString().split('T')[0]}.jsonl`);
  await fs.appendFile(filePath, JSON.stringify(entry) + '\n');
}

// Read metrics for date range
async function readMetrics(startDate: string, endDate: string) {
  const files = await fs.readdir(METRICS_DIR);
  const metrics: any[] = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const fileDate = file.replace('.jsonl', '');
    if (fileDate < startDate || fileDate > endDate) continue;

    const content = await fs.readFile(path.join(METRICS_DIR, file), 'utf-8');
    const lines = content.trim().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          metrics.push(JSON.parse(line));
        } catch (err) {
          // Skip invalid lines
        }
      }
    }
  }

  return metrics;
}

// Calculate success rates by day
function calculateDailySuccessRates(metrics: any[]) {
  const dailyStats: Record<string, Record<string, { success: number; total: number }>> = {};

  for (const metric of metrics) {
    const date = metric.timestamp.split('T')[0];
    const skill = metric.skill;

    if (!dailyStats[date]) {
      dailyStats[date] = {};
    }

    if (!dailyStats[date][skill]) {
      dailyStats[date][skill] = { success: 0, total: 0 };
    }

    dailyStats[date][skill].total++;
    if (metric.success) {
      dailyStats[date][skill].success++;
    }
  }

  return dailyStats;
}

// Cluster failure patterns
function clusterFailurePatterns(metrics: any[]) {
  const failures = metrics.filter(m => !m.success);
  const clusters: Record<string, number> = {};

  for (const failure of failures) {
    const errorType = failure.error_type || 'unknown';
    if (!clusters[errorType]) {
      clusters[errorType] = 0;
    }
    clusters[errorType]++;
  }

  return Object.entries(clusters)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

// Generate sparkline for success rate
function generateSparkline(rates: number[]) {
  const levels = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const maxRate = Math.max(...rates, 1);
  
  return rates.map(rate => {
    const index = Math.floor((rate / maxRate) * (levels.length - 1));
    return levels[index];
  }).join('');
}

// Display dashboard
async function displayDashboard() {
  await ensureMetricsDir();
  
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const startDateStr = startDate.toISOString().split('T')[0];

  const metrics = await readMetrics(startDateStr, endDate);
  const dailyStats = calculateDailySuccessRates(metrics);
  const failureClusters = clusterFailurePatterns(metrics);

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                  SKILL HEALTH DASHBOARD                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Success Rate Panel
  console.log('📊 SUCCESS RATE (30 DAYS)');
  console.log('─'.repeat(60));
  
  const dates = Object.keys(dailyStats).sort();
  const skills = [...new Set(metrics.map(m => m.skill))].sort();
  
  for (const skill of skills) {
    const rates = dates.map(date => {
      const stats = dailyStats[date][skill];
      return stats ? stats.success / stats.total : 0;
    });
    
    const sparkline = generateSparkline(rates);
    const currentRate = rates[rates.length - 1] || 0;
    console.log(`${skill.padEnd(30)} ${sparkline} ${(currentRate * 100).toFixed(1)}%`);
  }
  
  console.log('');

  // Failure Patterns Panel
  console.log('❌ FAILURE PATTERNS');
  console.log('─'.repeat(60));
  
  const maxCount = failureClusters.length > 0 ? failureClusters[0][1] : 0;
  for (const [errorType, count] of failureClusters) {
    const barLength = Math.round((count / maxCount) * 40);
    const bar = '█'.repeat(barLength);
    console.log(`${errorType.padEnd(25)} ${bar} ${count}`);
  }
  
  if (failureClusters.length === 0) {
    console.log('No failures recorded');
  }
  
  console.log('');

  // Summary Statistics
  console.log('📈 SUMMARY STATISTICS');
  console.log('─'.repeat(60));
  console.log(`Total skill invocations: ${metrics.length}`);
  console.log(`Success rate: ${(metrics.filter(m => m.success).length / metrics.length * 100).toFixed(1)}%`);
  console.log(`Failure rate: ${(metrics.filter(m => !m.success).length / metrics.length * 100).toFixed(1)}%`);
  console.log(`Skills tracked: ${skills.length}`);
}

// Main CLI
async function main() {
  const args = Bun.argv.slice(2);
  
  if (args.includes('--dashboard')) {
    await displayDashboard();
  } else if (args.includes('--json')) {
    // JSON output mode
    await ensureMetricsDir();
    const metrics = await readMetrics('2020-01-01', new Date().toISOString().split('T')[0]);
    console.log(JSON.stringify({
      metrics,
      summary: {
        total: metrics.length,
        success: metrics.filter(m => m.success).length,
        failure: metrics.filter(m => !m.success).length
      }
    }, null, 2));
  } else {
    console.log('Skill Health Dashboard CLI');
    console.log('Usage:');
    console.log('  --dashboard    Show full dashboard');
    console.log('  --json         Machine-readable JSON output');
    console.log('  --panel <name> Show specific panel (success, failures, amendments, history)');
  }
}

// Only run CLI if this is the main module
if (import.meta.main) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { logSkillInvocation };

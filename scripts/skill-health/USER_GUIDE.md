# Skill Health Dashboard - User Guide

## Quick Start

### Basic Commands

```bash
# Show full dashboard
cd /Volumes/SanDisk1Tb/OhMyFloyd
bun run scripts/skill-health/integrations.ts dashboard

# Show quick stats
bun run scripts/skill-health/integrations.ts stats

# Show failure patterns
bun run scripts/skill-health/integrations.ts failures

# Track a skill manually
bun run scripts/skill-health/integrations.ts track my-skill 1

# Track a failed skill with error details
bun run scripts/skill-health/integrations.ts track my-skill 0 "validation_error" "Invalid input format"

# Wrap an existing skill for automatic tracking
bun run scripts/skill-health/integrations.ts wrap my-skill.ts arg1 arg2
```

## Key Bindings & Shortcuts

### Command Aliases

| Full Command | Alias | Description |
|-------------|-------|-------------|
| `dashboard` | `dash` | Show full dashboard |
| `track` | `t` | Track skill execution |
| `wrap` | `w` | Wrap skill for auto-tracking |
| `stats` | `s` | Show summary statistics |
| `failures` | `f` | Show failure patterns |

### Usage Patterns

```bash
# All commands accept aliases
bun run scripts/skill-health/integrations.ts dash
bun run scripts/skill-health/integrations.ts s
bun run scripts/skill-health/integrations.ts f

# Short form tracking
bun run scripts/skill-health/integrations.ts t my-skill 1

# Short form wrapping
bun run scripts/skill-health/integrations.ts w my-skill.ts
```

## Dashboard Interpretation

### Success Rate Panel

```
📊 SUCCESS RATE (30 DAYS)
────────────────────────────────────────────────────────────
continuous-learning            █ 100.0%
pre-edit-intelligence          ▆ 80.0% 
architectural-guardian         ▁ 0.0%
```

- **Skill Name**: Left-aligned, padded to 30 characters
- **Sparkline**: Visual representation of 30-day trend
- **Current Rate**: Percentage for today

**Sparkline Key**:
- `█` = 100% success
- `▇` = 87.5% success  
- `▆` = 75% success
- `▅` = 62.5% success
- `▄` = 50% success
- `▃` = 37.5% success
- `▂` = 25% success
- `▁` = 0% success

### Failure Patterns Panel

```
❌ FAILURE PATTERNS
────────────────────────────────────────────────────────────
validation_error          ████████████████████████████████████████ 3
timeout_error             ██████████████████████████████████████ 2
network_error             ██████████████████████████████████████ 2
```

- **Error Type**: Left-aligned, padded to 25 characters
- **Bar Chart**: Visual representation of frequency (scaled to longest bar)
- **Count**: Number of occurrences

### Summary Statistics

```
📈 SUMMARY STATISTICS
────────────────────────────────────────────────────────────
Total skill invocations: 15
Success rate: 73.3%
Failure rate: 26.7%
Skills tracked: 8
```

## Integration Guide

### For Skill Developers

Add tracking to your TypeScript skills:

```typescript
import { trackSkill } from './scripts/skill-health/tracker.ts';

async function mySkill() {
  const startTime = Date.now();
  
  try {
    // Your skill logic here
    const result = await doWork();
    
    await trackSkill('my-skill', true, {
      duration_ms: Date.now() - startTime,
      error_type: null,
      error_message: null
    });
    
    return result;
  } catch (err: any) {
    await trackSkill('my-skill', false, {
      duration_ms: Date.now() - startTime,
      error_type: err.name || 'unknown_error',
      error_message: err.message
    });
    
    throw err;
  }
}
```

### For CLI Users

Create shell aliases for quick access:

```bash
# Add to your ~/.bashrc or ~/.zshrc
alias skill-dash='cd /Volumes/SanDisk1Tb/OhMyFloyd && bun run scripts/skill-health/integrations.ts dashboard'
alias skill-stats='cd /Volumes/SanDisk1Tb/OhMyFloyd && bun run scripts/skill-health/integrations.ts stats'
alias skill-fail='cd /Volumes/SanDisk1Tb/OhMyFloyd && bun run scripts/skill-health/integrations.ts failures'

# Usage
skill-dash    # Show dashboard
skill-stats   # Show stats
skill-fail    # Show failures
```

### For Power Users

Create a dedicated skill health monitoring script:

```bash
#!/bin/bash
# skill-monitor.sh

cd /Volumes/SanDisk1Tb/OhMyFloyd

case "$1" in
  "dashboard"|"dash")
    bun run scripts/skill-health/integrations.ts dashboard
    ;;
  "stats"|"s")
    bun run scripts/skill-health/integrations.ts stats
    ;;
  "failures"|"fail"|"f")
    bun run scripts/skill-health/integrations.ts failures
    ;;
  "track"|"t")
    shift
    bun run scripts/skill-health/integrations.ts track "$@"
    ;;
  "wrap"|"w")
    shift
    bun run scripts/skill-health/integrations.ts wrap "$@"
    ;;
  *)
    echo "Usage: $0 {dashboard|stats|failures|track|wrap}"
    exit 1
    ;;
esac
```

## Monitoring Workflow

### Daily Monitoring

1. **Start of Day**: Check dashboard for overall health
   ```bash
   bun run scripts/skill-health/integrations.ts dashboard
   ```

2. **After Skill Execution**: Track results manually if not using wrapper
   ```bash
   bun run scripts/skill-health/integrations.ts track my-skill 1
   ```

3. **End of Day**: Review failure patterns
   ```bash
   bun run scripts/skill-health/integrations.ts failures
   ```

### Troubleshooting

1. **Identify Problem Skills**: Look for skills with low success rates
2. **Analyze Failure Patterns**: Check which error types are most common
3. **Review Recent Activity**: See the last 5 invocations
4. **Take Corrective Action**: Fix failing skills or improve error handling

## Data Management

### View Raw Data

```bash
# Show today's metrics
cat /Volumes/SanDisk1Tb/OhMyFloyd/.floyd/ecc/skills-metrics/$(date +%Y-%m-%d).jsonl

# Show all metrics files
ls -la /Volumes/SanDisk1Tb/OhMyFloyd/.floyd/ecc/skills-metrics/

# Query specific skill
cat /Volumes/SanDisk1Tb/OhMyFloyd/.floyd/ecc/skills-metrics/*.jsonl | grep 'continuous-learning'
```

### Backup Data

```bash
# Create backup
tar czvf skill-metrics-backup-$(date +%Y-%m-%d).tar.gz /Volumes/SanDisk1Tb/OhMyFloyd/.floyd/ecc/skills-metrics/

# Restore from backup
rm -rf /Volumes/SanDisk1Tb/OhMyFloyd/.floyd/ecc/skills-metrics/
tar xzvf skill-metrics-backup-*.tar.gz -C /
```

## Best Practices

### For Maximum Value

1. **Track All Skills**: Use the wrapper for automatic tracking
2. **Be Consistent**: Track both successes and failures
3. **Use Descriptive Error Types**: Helps with pattern analysis
4. **Review Regularly**: Check dashboard at least daily
5. **Act on Insights**: Fix skills with declining success rates

### Error Type Taxonomy

Use these standard error types for consistent clustering:

- `validation_error`: Input validation failed
- `timeout_error`: Operation timed out
- `network_error`: Network connectivity issues
- `auth_error`: Authentication/authorization failed
- `not_found_error`: Resource not found
- `rate_limit_error`: API rate limit exceeded
- `parse_error`: Data parsing failed
- `dependency_error`: Missing or incompatible dependency
- `permission_error`: Insufficient permissions
- `unknown_error`: Unexpected/unclassified errors

## Troubleshooting

### Common Issues

**Problem**: Dashboard shows no data
- **Solution**: Ensure you're tracking skills first with the tracker or wrapper

**Problem**: Success rate shows NaN%
- **Solution**: Need at least one tracked skill invocation

**Problem**: Wrapper doesn't work with my script
- **Solution**: Use manual tracking or ensure your script is Bun-compatible

**Problem**: Can't find metrics directory
- **Solution**: It's created automatically at first use: `/Volumes/SanDisk1Tb/OhMyFloyd/.floyd/ecc/skills-metrics/`

### Getting Help

```bash
# Show help
bun run scripts/skill-health/integrations.ts --help

# Show help (short form)
bun run scripts/skill-health/integrations.ts -h
```

## Advanced Usage

### JSON API

For programmatic access to metrics:

```bash
# Get full JSON output
bun run scripts/skill-health/dashboard.ts --json

# Process with jq
bun run scripts/skill-health/dashboard.ts --json | jq '.summary'

# Get specific skill metrics
bun run scripts/skill-health/dashboard.ts --json | jq '.metrics[] | select(.skill == "continuous-learning")'
```

### Custom Reporting

Create custom reports using the JSON output:

```bash
#!/bin/bash
# weekly-report.sh

cd /Volumes/SanDisk1Tb/OhMyFloyd
DATA=$(bun run scripts/skill-health/dashboard.ts --json)

echo "=== WEEKLY SKILL REPORT ==="
echo "Generated: $(date)"
echo ""
echo "Summary:"
echo "  Total Invocations: $(echo $DATA | jq '.summary.total')"
echo "  Success Rate: $(echo $DATA | jq '.summary.success')/$(echo $DATA | jq '.summary.total') ($(echo "scale=1; $(echo $DATA | jq '.summary.success') * 100 / $(echo $DATA | jq '.summary.total')" | bc)%)"
echo "  Failure Rate: $(echo $DATA | jq '.summary.failure')/$(echo $DATA | jq '.summary.total') ($(echo "scale=1; $(echo $DATA | jq '.summary.failure') * 100 / $(echo $DATA | jq '.summary.total')" | bc)%)"
```

## Version History

### 1.0.0 (Current)
- Initial implementation
- Dashboard with sparklines
- Failure pattern clustering
- Multiple output formats
- Manual and automatic tracking
- Comprehensive documentation

## Support

For issues or questions:
1. Check this user guide
2. Review the README.md
3. Examine the source code
4. Contact your system administrator

## License

This software is part of the OhMyFloyd platform and is subject to its licensing terms.

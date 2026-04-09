# Skill Health Dashboard - Quick Start Guide

## 🚀 Get Started in 30 Seconds

### 1. Show Dashboard
```bash
cd /Volumes/SanDisk1Tb/OhMyFloyd
bun run scripts/skill-health/integrations.ts dashboard
```

### 2. Track a Skill
```bash
# Success
bun run scripts/skill-health/integrations.ts track my-skill 1

# Failure
bun run scripts/skill-health/integrations.ts track my-skill 0 "error_type" "error_message"
```

### 3. Check Stats
```bash
bun run scripts/skill-health/integrations.ts stats
```

## 📊 Daily Workflow

### Morning
```bash
# Check overall health
bun run scripts/skill-health/integrations.ts dashboard
```

### After Skill Execution
```bash
# Track successful execution
bun run scripts/skill-health/integrations.ts track my-skill 1

# Track failed execution
bun run scripts/skill-health/integrations.ts track my-skill 0 "validation_error" "Invalid input"
```

### End of Day
```bash
# Review failure patterns
bun run scripts/skill-health/integrations.ts failures

# Get summary statistics
bun run scripts/skill-health/integrations.ts stats
```

## 🎯 Key Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `dashboard` | `dash` | Full dashboard view |
| `stats` | `s` | Summary statistics |
| `failures` | `f` | Failure patterns |
| `track` | `t` | Track skill execution |
| `wrap` | `w` | Wrap script for auto-tracking |
| `json` | `j` | JSON output |

## 💡 Quick Tips

### Track Multiple Skills
```bash
bun run scripts/skill-health/integrations.ts track skill1 1
bun run scripts/skill-health/integrations.ts track skill2 0 "timeout" "Operation timed out"
bun run scripts/skill-health/integrations.ts track skill3 1
```

### Check Recent Activity
```bash
bun run scripts/skill-health/integrations.ts stats
# Shows last 5 invocations with timestamps
```

### Monitor Failure Trends
```bash
bun run scripts/skill-health/integrations.ts failures
# Shows clustered error types with percentages
```

### Get Machine-Readable Data
```bash
bun run scripts/skill-health/integrations.ts json
# Full JSON export for scripting
```

## ⚡ Shortcuts

### Shell Aliases (add to ~/.bashrc or ~/.zshrc)
```bash
alias skill-dash='cd /Volumes/SanDisk1Tb/OhMyFloyd && bun run scripts/skill-health/integrations.ts dashboard'
alias skill-stats='cd /Volumes/SanDisk1Tb/OhMyFloyd && bun run scripts/skill-health/integrations.ts stats'
alias skill-fail='cd /Volumes/SanDisk1Tb/OhMyFloyd && bun run scripts/skill-health/integrations.ts failures'
alias skill-track='cd /Volumes/SanDisk1Tb/OhMyFloyd && bun run scripts/skill-health/integrations.ts track'
```

### Usage
```bash
skill-dash      # Show dashboard
skill-stats     # Show stats
skill-fail      # Show failures
skill-track my-skill 1  # Track success
```

## 📈 Understanding the Dashboard

### Success Rate Panel
```
📊 SUCCESS RATE (30 DAYS)
────────────────────────────────────────────────────────────
continuous-learning            █ 100.0%
pre-edit-intelligence          ▆ 80.0% 
architectural-guardian         ▁ 0.0%
```

- **Skill Name**: What skill was tracked
- **Sparkline**: Visual trend (█ = 100%, ▁ = 0%)
- **Percentage**: Current success rate

### Failure Patterns
```
❌ FAILURE PATTERNS
────────────────────────────────────────────────────────────
validation_error          ████████████████████████████████████████ 5
timeout_error             ██████████████████████████████████████ 3
```

- **Error Type**: Category of failure
- **Bar**: Relative frequency
- **Count**: Number of occurrences

### Summary Statistics
```
📈 SUMMARY STATISTICS
────────────────────────────────────────────────────────────
Total skill invocations: 25
Success rate: 84.0%
Failure rate: 16.0%
Skills tracked: 8
```

- **Total**: All tracked invocations
- **Success Rate**: Percentage successful
- **Failure Rate**: Percentage failed
- **Skills Tracked**: Number of unique skills

## 🔍 Common Patterns

### Healthy System
```
Success rate: 90%+
Failure patterns: Few, infrequent
Recent activity: Mostly ✅
```

### Needs Attention
```
Success rate: 70-89%
Failure patterns: Some clusters emerging
Recent activity: Mix of ✅ and ❌
```

### Problematic
```
Success rate: < 70%
Failure patterns: Clear dominant patterns
Recent activity: Multiple ❌ in row
```

## 🛠 Troubleshooting

### No Data Showing
```bash
# Solution: Track some skills first
bun run scripts/skill-health/integrations.ts track test-skill 1
```

### Wrong Directory
```bash
# Solution: Always run from OhMyFloyd root
cd /Volumes/SanDisk1Tb/OhMyFloyd
```

### Command Not Found
```bash
# Solution: Use full path
bun run scripts/skill-health/integrations.ts dashboard
```

## 📚 Learn More

- **Full Documentation**: `README.md`
- **User Guide**: `USER_GUIDE.md`
- **Implementation Details**: `IMPLEMENTATION_SUMMARY.md`

```bash
# Read documentation
less scripts/skill-health/USER_GUIDE.md
```

## 🎓 Pro Tips

1. **Track Everything**: More data = better insights
2. **Use Descriptive Error Types**: Helps with pattern analysis
3. **Check Daily**: Catch issues early
4. **Monitor Trends**: Watch for declining success rates
5. **Act on Insights**: Fix skills with consistent failures

**Remember**: The dashboard is only as good as the data you put into it! ✅

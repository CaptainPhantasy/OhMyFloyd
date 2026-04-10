# OMP vs OMF Platform Architecture Explanation

**Date**: April 9, 2026  
**Context**: Understanding the relationship between OMP and OMF commands

---

## Executive Summary

**OMF** and **OMP** are the **SAME CODEBASE** but different versions:

- **OMF** = **Oh My Floyd** (local fork, version 14.0.2, **HAS THE FIX**)
- **OMP** = **Oh My Pi** (npm installed, version 13.19.0, **NO FIX**)

They are **NOT** separate runtimes. They're symlinks pointing to different builds of the same application.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Git Repository Hierarchy                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Upstream (oh-my-pi)                                        │
│  └─ https://github.com/can1357/oh-my-pi                    │
│     └─ @oh-my-pi/pi-coding-agent package                   │
│        └─ Published to npm as version 13.19.0              │
│                                                              │
│  Fork (OhMyFloyd)                                           │
│  └─ https://github.com/CaptainPhantasy/OhMyFloyd           │
│     └─ Local development with Ctrl+O fix                   │
│        └─ Built as version 14.0.2                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Command Symlinks                                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  /opt/homebrew/bin/omf (Oh My Floyd)                       │
│  └─> /Volumes/SanDisk1Tb/OhMyFloyd/                        │
│      packages/coding-agent/dist/omp                         │
│      └─ Compiled binary from local build                   │
│         └─ Version: 14.0.2                                 │
│            └─ HAS CTRL+O FIX ✅                             │
│                                                              │
│  ~/.bun/bin/omp (Oh My Pi)                                  │
│  └─> ~/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts  │
│      └─ Installed npm package (global)                     │
│         └─ Version: 13.19.0                                │
│            └─ NO CTRL+O FIX ❌                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Evidence

### Symlink Investigation

**Command**: `ls -lh ~/.bun/bin/omp /opt/homebrew/bin/omf`

**Output**:
```
lrwxr-xr-x  /opt/homebrew/bin/omf -> /Volumes/SanDisk1Tb/OhMyFloyd/packages/coding-agent/dist/omp
lrwxrwxrwx  ~/.bun/bin/omp -> ../../node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts
```

**Analysis**:
- `omf` points to **local build** in OhMyFloyd repository
- `omp` points to **npm installed** package in node_modules

---

### Version Comparison

**Command**: `omf --version && omp --version`

**Output**:
```
omp/14.0.2  ← OMF (local build)
omp/13.19.0 ← OMP (npm package)
```

**Analysis**:
- OMF is 14.0.2 (newer, has fix)
- OMP is 13.19.0 (older, no fix)

---

### Code Comparison

**OMF Code** (14.0.2 - with fix):
```typescript
setToolsExpanded(expanded: boolean): void {
    this.ctx.toolOutputExpanded = expanded;

    // Guard against invalid chat container state
    if (!this.ctx.chatContainer || !Array.isArray(this.ctx.chatContainer.children)) {
        logger.warn("Chat container not initialized or invalid");
        return;
    }

    // Apply expansion state to all expandable children with error handling
    for (const child of this.ctx.chatContainer.children) {
        if (isExpandable(child)) {
            try {
                child.setExpanded(expanded);
            } catch (error) {
                logger.error("Failed to set expansion state on component", {
                    expanded,
                    componentType: child.constructor.name,
                    error: String(error),
                });
            }
        }
    }

    this.ctx.ui.requestRender();
    logger.debug("Tool output expansion toggled", {
        expanded,
        componentCount: this.ctx.chatContainer.children.length,
    });
}
```

**OMP Code** (13.19.0 - no fix):
```typescript
setToolsExpanded(expanded: boolean): void {
    this.ctx.toolOutputExpanded = expanded;
    for (const child of this.ctx.chatContainer.children) {
        if (isExpandable(child)) {
            child.setExpanded(expanded);  // ❌ No error handling!
        }
    }
    this.ctx.ui.requestRender();
}
```

**Difference**: OMF has defensive programming (validation, try-catch, logging). OMP does not.

---

### Git Repository Structure

**Command**: `git remote -v`

**Output**:
```
origin   https://github.com/CaptainPhantasy/OhMyFloyd.git
upstream https://github.com/can1357/oh-my-pi.git
```

**Analysis**:
- **Origin** = OhMyFloyd (your fork)
- **Upstream** = oh-my-pi (original project)

---

## Naming Convention

| Name | Full Name | Meaning | Version | Has Fix |
|------|-----------|---------|---------|---------|
| OMF | Oh My Floyd | Local fork build | 14.0.2 | ✅ Yes |
| OMP | Oh My Pi | Upstream npm install | 13.19.0 | ❌ No |

---

## Shared vs Separate

### They Share:
- ✅ Same codebase origin (oh-my-pi)
- ✅ Same TypeScript source
- ✅ Same package structure
- ✅ Same configuration format
- ✅ Same session files (`~/.omp/`)

### They Don't Share:
- ❌ Different builds (local vs npm)
- ❌ Different versions (14.0.2 vs 13.19.0)
- ❌ Different code states (with fix vs without)
- ❌ Different binaries/entrypoints

---

## How This Affects The Fix

### Where The Fix Is Applied

**File**: `/Volumes/SanDisk1Tb/OhMyFloyd/packages/coding-agent/src/modes/controllers/input-controller.ts`

**Applies To**:
- ✅ **OMF** (Oh My Floyd) - Uses local build with fix
- ❌ **OMP** (Oh My Pi) - Uses npm package without fix

### Testing Performed

**Test executed on**: `omf` (14.0.2)

**Result**: ✅ Ctrl+O works without crashing

**NOT tested on**: `omp` (13.19.0)

**Expected behavior**: ❌ Would still crash (no fix present)

---

## Why The Different Interfaces

**User Observation**: "when I run the OMF command I get a slightly different interface than when I run the OMP command"

**Explanation**:

1. **Version Difference**:
   - OMF = 14.0.2 (newer features, UI improvements)
   - OMP = 13.19.0 (older UI, missing recent updates)

2. **Update Prompts**:
   - OMP shows "upgrade to 14.0.2" because it's on 13.19.0
   - OMF doesn't show upgrade prompt because it IS 14.0.2

3. **Not Different Runtimes**:
   - Same application
   - Just different versions
   - Like having Firefox 100 and Firefox 120 installed

---

## How Updates Work

### For OMP (Upstream)

**Update Method**: npm install
```bash
npm install -g @oh-my-pi/pi-coding-agent@latest
```

**Source**: Published to npm by upstream maintainer (can1357)

**When available**: After upstream release

---

### For OMF (Fork)

**Update Method**: Local build
```bash
cd /Volumes/SanDisk1Tb/OhMyFloyd
git pull origin main  # or: git pull upstream main
bun install
bun run build
```

**Source**: Local repository

**When available**: Immediately after code changes

---

## Recommendation

### For Testing The Fix

**Use**: `omf` (Oh My Floyd)

**Reason**: Has the Ctrl+O crash fix

**Verification**:
```bash
omf --version  # Should show 14.0.2
```

---

### For Daily Use

**Options**:

1. **Use OMF** (local build)
   - ✅ Has latest fixes
   - ✅ Your customizations
   - ❌ Must manually rebuild after changes
   - ❌ Not published to npm

2. **Use OMP** (npm package)
   - ✅ Easy updates via npm
   - ✅ Stable releases
   - ❌ No recent fixes yet
   - ❌ Ctrl+O will crash

3. **Merge Fix Upstream**
   - Create PR to oh-my-pi
   - Get fix into official release
   - Then both will have it

---

## Next Steps

### To Get Fix Into OMP

1. **Create Pull Request** to upstream (can1357/oh-my-pi)
   ```bash
   git push origin main
   # Then create PR on GitHub
   ```

2. **Wait for upstream merge**
   - Maintainer reviews
   - Merges to main
   - Publishes new npm version

3. **Update global install**
   ```bash
   npm install -g @oh-my-pi/pi-coding-agent@latest
   ```

4. **Both commands will have fix**
   - `omp` and `omf` both work

---

### To Use Fix Now

**Option 1**: Use `omf` instead of `omp`
```bash
omf  # Starts Oh My Floyd with fix
```

**Option 2**: Update symlink to point omp to local build
```bash
rm ~/.bun/bin/omp
ln -s /Volumes/SanDisk1Tb/OhMyFloyd/packages/coding-agent/dist/omp ~/.bun/bin/omp
```

**Option 3**: Create alias in shell config
```bash
echo 'alias omp="omf"' >> ~/.zshrc
source ~/.zshrc
```

---

## Summary

| Question | Answer |
|----------|--------|
| Are OMF and OMP different platforms? | No, same codebase |
| Do they share code? | Yes, OMF is a fork of OMP |
| Why different versions? | OMF = local build, OMP = npm install |
| Which has the fix? | OMF (14.0.2) has it |
| Which was tested? | OMF only |
| Will OMP crash on Ctrl+O? | Yes, until fix is merged upstream |
| How to use fix now? | Run `omf` instead of `omp` |

---

**Bottom Line**: OMF and OMP are the same application at different versions. The fix is ONLY in the local OMF build (14.0.2), not in the npm-installed OMP (13.19.0). To use the fix, run `omf`.

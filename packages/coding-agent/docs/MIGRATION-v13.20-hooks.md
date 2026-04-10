# Migration Guide: Hook System Consolidation (v13.20)

This document describes the migration path for users who wrote against the legacy hook API surface.

## Summary

The hook runtime has been consolidated into the extension runtime. The `--hook` CLI flag and `HookAPI` types remain available as compatibility aliases, but the underlying runtime is now unified.

## What Changed

| Old | New | Notes |
|-----|-----|-------|
| `HookRunner` class | `ExtensionRunner` class | Direct replacement |
| `HookToolWrapper` class | `ExtensionToolWrapper` class | Direct replacement |
| `discoverAndLoadHooks()` | `loadExtensions()` | Use extension loader |
| `loadHooks()` / `loadHook()` | `loadExtensions()` | Use extension loader |
| `--hook /path/to/hook.ts` | `--extension /path/to/hook.ts` | Both work (--hook is alias) |
| `import from "hooks/loader"` | `import from "extensions/loader"` | Module removed |
| `import from "hooks/runner"` | `import from "extensions/runner"` | Module removed |
| `import from "hooks/tool-wrapper"` | N/A | Use ExtensionToolWrapper |

## What Still Works (No Changes Needed)

| Concept | Status |
|---------|--------|
| `--hook` CLI flag | Works (alias to --extension) |
| `import type { HookAPI } from "hooks"` | Works (type alias) |
| `import type { HookContext } from "hooks"` | Works (type alias) |
| `import type { HookFactory } from "hooks"` | Works (type alias) |
| All event types (`SessionStartEvent`, etc.) | Work (re-exported) |
| Hook factory signature `(pi: HookAPI) => void` | Works |
| `pi.on()`, `pi.sendMessage()`, `pi.exec()` | Work |

## What Was Removed (No Replacement)

| Removed | Reason |
|---------|--------|
| `resources_discover` event | No production emitter existed |
| `ResourcesDiscoverEvent` type | Event removed |
| `ResourcesDiscoverResult` type | Event removed |
| `emitResourcesDiscover()` method | Event removed |

## Migration Steps

### If you imported from `hooks/loader`, `hooks/runner`, or `hooks/tool-wrapper`:

**Before:**
```typescript
import { discoverAndLoadHooks, loadHooks } from "@oh-my-pi/pi-coding-agent/extensibility/hooks/loader";
import { HookRunner } from "@oh-my-pi/pi-coding-agent/extensibility/hooks/runner";
import { HookToolWrapper } from "@oh-my-pi/pi-coding-agent/extensibility/hooks/tool-wrapper";
```

**After:**
```typescript
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { ExtensionToolWrapper } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/tool-wrapper";
```

### If you used `resources_discover` event:

This event had no production emitter and has been removed. If you need dynamic resource discovery, use:
- `session_start` event to perform discovery at startup
- Custom tools or commands for on-demand discovery

### If you only use the public hook API:

**No changes needed.** The following patterns continue to work:

```typescript
import type { HookAPI, HookFactory } from "@oh-my-pi/pi-coding-agent/hooks";

const hook: HookFactory = (pi: HookAPI) => {
  pi.on("session_start", async () => { /* ... */ });
  pi.on("tool_call", async (event, ctx) => { /* ... */ });
};

export default hook;
```

## Verification

After migrating, verify your extension works:

```bash
# Load extension via --extension (preferred)
omp --extension /path/to/your/extension.ts

# Load extension via --hook (compatibility alias)
omp --hook /path/to/your/extension.ts
```

Both commands should behave identically.

## Questions

If you encounter issues migrating, please open an issue at:
https://github.com/can1357/oh-my-pi/issues

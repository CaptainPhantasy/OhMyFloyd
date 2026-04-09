# Hooks (Legacy Compatibility Layer)

This document describes the hook compatibility layer that preserves the `@oh-my-pi/pi-coding-agent/hooks` API while forwarding to the extension system.

## Current status

The hook subsystem has been consolidated into the extension runtime:

- `--hook` CLI flag is an alias for `--extension` (paths merged into `additionalExtensionPaths`)
- All event dispatch goes through `ExtensionRunner`
- All tool wrapping uses `ExtensionToolWrapper`
- `src/extensibility/hooks/types.ts` exports type aliases to `extensions/types.ts`

## Key files

| File | Purpose |
|------|---------|
| `src/extensibility/hooks/types.ts` | Type aliases forwarding to extension types |
| `src/extensibility/hooks/index.ts` | Re-exports for backward compatibility |
| `src/extensibility/extensions/runner.ts` | Production event dispatch |
| `src/extensibility/extensions/loader.ts` | Extension/hook module loading |
| `src/extensibility/extensions/types.ts` | Canonical event and API types |

## Writing a hook (extension)

A hook module must default-export a factory:

```ts
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/hooks";

export default function hook(pi: HookAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && String(event.input.command ?? "").includes("rm -rf")) {
      return { block: true, reason: "blocked by policy" };
    }
  });
}
```

The factory can:

- Register event handlers with `pi.on(...)`
- Send persistent custom messages with `pi.sendMessage(...)`
- Persist non-LLM state with `pi.appendEntry(...)`
- Register slash commands via `pi.registerCommand(...)`
- Register custom message renderers via `pi.registerMessageRenderer(...)`
- Run shell commands via `pi.exec(...)`

## Type aliases

The `hooks/types.ts` module provides these aliases for backward compatibility:

| Hook Type | Extension Type |
|-----------|----------------|
| `HookAPI` | `ExtensionAPI` |
| `HookContext` | `ExtensionContext` |
| `HookCommandContext` | `ExtensionCommandContext` |
| `HookUIContext` | `ExtensionUIContext` |
| `HookHandler` | `ExtensionHandler` |
| `HookFactory` | `ExtensionFactory` |
| `HookError` | `ExtensionError` |
| `HookMessageRenderer` | `MessageRenderer` |

All event types (`SessionStartEvent`, `ToolCallEvent`, etc.) are re-exported directly from `extensions/types.ts`.

## Migration

Existing hooks work without modification. The `--hook` flag and `HookAPI` types are preserved.

For new code, prefer importing directly from extensions:

```ts
// Preferred for new code
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";

// Still works (backward compatible)
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/hooks";
```

## Event reference

See `src/extensibility/extensions/types.ts` for the canonical event type definitions. All events documented in `ExtensionAPI.on()` have corresponding emitters in `ExtensionRunner`.

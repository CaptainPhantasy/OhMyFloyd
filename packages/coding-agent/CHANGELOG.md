# Changelog

## [Unreleased]

### Breaking Changes

- **Extension runtime is now the only runtime path.** The legacy hook runtime (`HookRunner`, `HookToolWrapper`, `discoverAndLoadHooks`, `loadHooks`) has been removed. All extension/hook loading now goes through `ExtensionRunner` and `loadExtensions`.

- **`resources_discover` event removed.** This event was documented but had no production emitter. It has been removed from the supported event surface.

### Changed

- `--hook` CLI flag is now a compatibility alias for `--extension`. Both flags merge paths into `additionalExtensionPaths` and are handled by the extension runtime.

- `src/extensibility/hooks/types.ts` now contains only type aliases forwarding to `src/extensibility/extensions/types.ts`. No runtime code remains in the hooks module.

- `src/extensibility/hooks/index.ts` re-exports only from `types.ts`. The deleted modules (`loader.ts`, `runner.ts`, `tool-wrapper.ts`) are no longer exported.

### Added

- `omp floyd`, a provider-credential-free coding partner mode whose sessions, tools, permissions, and decisions are owned by Floyd Core through `@floyd/sdk`
- CI job `dead-runtime-check` that fails on reintroduction of legacy hook runtime code
- Extension event contract tests (`test/extension-event-contract.test.ts`) verifying all documented events have production emitters
- E2E smoke test for extension loading from CLI (`test/extension-cli-smoke.test.ts`)
- Regression test for `--hook` compatibility (`test/hook-compatibility-regression.test.ts`)

### Removed

- `src/extensibility/hooks/loader.ts` (256 lines)
- `src/extensibility/hooks/runner.ts` (425 lines)
- `src/extensibility/hooks/tool-wrapper.ts` (107 lines)
- `ResourcesDiscoverEvent` and `ResourcesDiscoverResult` types
- `ExtensionRunner.emitResourcesDiscover()` method
- `ExtensionAPI.on("resources_discover", ...)` handler registration

# OhMyFloyd Fork — Single Source of Truth

**Established:** 2026-04-09T09:49:18Z
**Last updated:** 2026-04-09T09:49:18Z
**Authority:** This document is the sole authoritative reference for the OhMyFloyd fork's identity, architecture, upstream relationship, and maintenance workflow. All prior documents describing fork strategy, rebrand procedures, migration plans, or patch workflows are superseded by this file and must not be followed.

---

## 1. Document Governance

This file (`OHMYFLOYD.md` at repository root) is the single source of truth for all fork-level decisions. The following rules are permanent:

- **No competing authority.** No other document in this repository may define fork identity, upstream sync strategy, patch workflow, or branching policy. If a conflict exists between this file and any other file, this file wins.
- **Single update path.** Changes to fork strategy, upstream workflow, or patch architecture are enacted by updating this file first, then implementing. Never the reverse.
- **Supersession is explicit.** This document supersedes the following files, which are now historical artifacts and must not be used as operational guidance:
  - `HANDOFF_PROMPT.md` — Stale rebrand/migration instructions referencing "Floyd" binary name, `~/.floyd/` config dir, and legacy Go agent. Predates OhMyFloyd identity.
  - `POST_BUILD_HANDOFF.md` — Stale post-build tasks referencing Floyd v13.14.2 and legacy auth migration. Predates upstream rebase.
  - `docs/porting-from-pi-mono.md` — One-time porting guide. Completed and no longer applicable.
  - Any `.patch` files outside of `patches/rebased/` — Stale artifacts from prior patch extraction attempts.
- **Domain-specific SSOT documents are unaffected.** Files that declare themselves source of truth for a specific technical domain (e.g., `docs/session.md` for session format) retain authority within their domain. This file governs fork-level concerns only.

---

## 2. Fork Identity

| Field | Value |
|-------|-------|
| Name | OhMyFloyd |
| Repository | `git@github.com:CaptainPhantasy/OhMyFloyd.git` |
| Upstream | `https://github.com/can1357/oh-my-pi.git` (remote name: `upstream`) |
| Origin | `https://github.com/CaptainPhantasy/OhMyFloyd.git` (remote name: `origin`) |
| License | Inherits upstream MIT license |
| Binary name | `omp` (unchanged from upstream) |
| Config directory | `~/.omp/` (unchanged from upstream) |
| npm package name | `@oh-my-pi/pi-coding-agent` (upstream's; this fork is not published separately) |

OhMyFloyd is a maintained fork of oh-my-pi. It tracks upstream releases and applies a small, well-defined set of customizations on top. It is not an independent product. The fork exists to carry features and configuration specific to the CaptainPhantasy environment while staying current with upstream development.

---

## 3. Baseline State at Establishment

| Ref | SHA | Description |
|-----|-----|-------------|
| `upstream/main` | `8f8ced7d7` | Upstream oh-my-pi HEAD at time of rebase |
| `omf-rebase` HEAD | `0af5502ed` | 8 customization commits on top of upstream/main |
| `origin/main` | `4140b3992` | Stale standalone history; to be replaced by force-push of `omf-rebase` |
| Upstream version | 14.0.2 | npm published version at time of rebase |

---

## 4. Customizations

The fork carries exactly 8 commits on top of upstream. Each commit is a self-contained customization. The list below is exhaustive — if a change is not listed here, it is not a fork customization and should not be treated as one.

| # | Commit | Description | Files touched |
|---|--------|-------------|---------------|
| 1 | `de20c1fd3` | Remove external CI/CD workflows | 1 (deletion of `.github/workflows/ci.yml`) |
| 2 | `957c57799` | Harden execution paths, add planning guards | 8 (new: `intel/`, `intelligence/`, `planning/`, `security/`) |
| 3 | `b5ef9375e` | Todo reminder: progress-based check replaces auto-continue heuristic | 8 (modifies `agent-session.ts`, `eager-todo.md`, adds test) |
| 4 | `2369d5ebc` | VIBEBOX configuration for Debian VM sandbox | 1 (new: `vibebox.toml`) |
| 5 | `3e571e4ff` | VIBEBOX skill for isolated sandbox | 1 (new: `.omp/skills/vibebox/SKILL.md`) |
| 6 | `5535ca93b` | GLM-5.1 model in ZAI provider catalog | 4 (modifies `models.json`, adds security whitelist entries, test) |
| 7 | `673b3f156` | Fork branding and documentation | 3 (STAGES.md, `assets/FLOYD_ASCII.txt`, `docs/guides/zai-claude-provider.md`) |
| 8 | `0af5502ed` | Hooks refactor: consolidate hook runtime into extension system | 21 (deletes `hooks/loader.ts`, `hooks/runner.ts`, `hooks/tool-wrapper.ts`; guts `hooks/types.ts` to aliases; adds 4 test files + `check-dead-runtime.ts`) |
| 9 | `d4dcf670b` | OHMYFLOYD.md: fork SSOT document | 1 (this file) |
| 10 | `27611f5b0` | Continuous learning system: built-in extension | 7 (6 module files in `extensibility/continuous-learning/` + `sdk.ts` wiring) |

### What is NOT a customization

The following items from earlier fork history are explicitly excluded. They are not carried forward and must not be re-introduced:
- **`packages/coding-agent/src/patch/`** (4 files) — Stale copy of upstream's edit system. Upstream renamed `patch/` to `edit/` in 14.0.x. Removed during rebase.
- **`packages/react-edit-benchmark/runs/`** (~80 files) — Benchmark run data. Not runtime code. Not carried forward.
- **`packages/coding-agent/src/commit/git/`** (3 files) — Unintegrated git operations module. Not imported by any consumer. Not carried forward.
- **`packages/coding-agent/src/web/search/code-search.ts`** — Unintegrated code search. Not carried forward.
- **Commit `ed5560c4f`** ("OhMyFloyd v13.19.0 rollup") — A 700-file squash commit that mixed upstream sync with fork features. This commit is the reason the old patch set was unmaintainable. It has been decomposed: upstream content is now provided by the upstream base, and fork-specific content is captured in commits 1-10 above. This commit must never be cherry-picked or re-applied.

---

## 5. Patch Layer

All 10 customization commits are exported as sequential `git format-patch` files in `patches/rebased/`:

```
patches/
  apply-patches.sh          # Sequential applicator script
  rebased/
    0001-chore-remove-external-CI-CD-workflows.patch
    0002-feat-coding-agent-harden-execution-paths-and-add-pla.patch
    0003-fix-replace-todo-reminder-auto-continue-heuristic-wi.patch
    0004-chore-add-VIBEBOX-configuration-for-Debian-VM-sandbo.patch
    0005-feat-add-VIBEBOX-skill-for-isolated-Debian-VM-sandbo.patch
    0006-feat-add-GLM-5.1-model-to-ZAI-provider-catalog.patch
    0007-chore-add-OhMyFloyd-fork-branding-and-documentation.patch
    0008-refactor-extensibility-consolidate-hook-runtime-into.patch
    0009-doc-establish-OHMYFLOYD.md-as-fork-SSOT-supersede-st.patch
    0010-feat-integrate-continuous-learning-system-as-built-i.patch
```

**Patches are sequential.** They must be applied in order. Patch 0006 depends on files created by 0002. Patch 0008 depends on types modified by 0003.

**Patches target the monorepo.** They use monorepo-relative paths (e.g., `packages/coding-agent/src/...`). They do not apply to npm tarballs.

**Patches are regenerated after every rebase.** They are not hand-edited. The canonical source is always the git commits; the patches are a derived artifact for applying customizations to a fresh upstream clone.

---

## 6. Upstream Sync Workflow

This is the only sanctioned method for incorporating upstream changes. No alternative workflow (direct merge, cherry-pick from upstream into old history, squash-sync commits) is permitted.

### Procedure

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Rebase customizations onto new upstream HEAD
git rebase upstream/main

# 3. Resolve conflicts (if any)
#    - For files we deleted (hooks/loader.ts, hooks/runner.ts, hooks/tool-wrapper.ts):
#      git rm <file>
#    - For files we modified (agent-session.ts, hooks/types.ts):
#      Keep our logic changes, adopt upstream's API if signatures changed
#    - For models.json conflicts: take upstream's version (more current)

# 4. Run tests
cd packages/coding-agent
bun install
bun test test/hook-runtime-compatibility.test.ts \
         test/hook-compatibility-regression.test.ts \
         test/extension-cli-smoke.test.ts \
         test/extension-event-contract.test.ts \
         test/compaction-hooks.test.ts

# 5. Regenerate patches
git format-patch upstream/main..HEAD -o patches/rebased

# 6. Verify patches apply to fresh upstream
git clone https://github.com/can1357/oh-my-pi.git /tmp/verify
cd /tmp/verify
for p in /path/to/OhMyFloyd/patches/rebased/*.patch; do
    git apply "$p" || echo "FAIL: $(basename $p)"
done

# 7. Update this document's "Last updated" timestamp

# 8. Commit and push
git add -A
git commit --amend --no-edit  # fold patch regeneration into last commit
git push --force-with-lease origin main
```

### Rules

- **Rebase, never merge.** Merge commits create parallel history that makes future rebases progressively harder. The fork must always be a linear sequence of commits on top of upstream.
- **Never squash multiple upstream versions into one sync commit.** That is what created the `ed5560c4f` problem. Each `git rebase` advances the base one upstream version at a time.
- **Patches are derived, not source.** If a patch fails to apply after regeneration, the fix is in the commit, not in the patch file.
- **Test after every rebase.** The 5 test files listed above are the minimum verification gate. If they fail, the rebase is not complete.

---

## 7. Adding New Customizations

New fork-specific features follow this process:

1. Create the feature on a topic branch off `main` (which tracks upstream via rebase).
2. Keep the commit self-contained: one commit per feature, touching as few upstream files as possible.
3. Prefer new files over modifying existing upstream files. New files produce clean patches; modifications produce context-dependent patches that break on upstream changes.
4. After merging to `main`, regenerate patches per Section 6 step 5.
5. Update the customization table in Section 4.
6. Update the "Last updated" timestamp.

### What must not be added

- Code that duplicates upstream functionality (even if upstream's version is different).
- Modules that are not imported by any consumer (dead code on arrival).
- Squash commits that mix upstream sync with fork features.
- Backward-compatibility shims for APIs that changed upstream. Take upstream's API and adapt fork code to match.

---

## 8. Branch Policy

| Branch | Purpose | Update method |
|--------|---------|---------------|
| `main` | Production. Always rebased on upstream/main + customizations. | `git rebase upstream/main` then force-push |
| `omf-rebase` | Working branch for rebase operations. Merged to main when verified. | Created per-rebase, deleted after |
| Topic branches | New features or fixes. | Branch from main, merge back, delete |

No long-lived feature branches. No release branches. No develop branch. The fork is simple: upstream + patches. The branch structure reflects that.

---

## 9. File Authority Map

| File | Authority | Notes |
|------|-----------|-------|
| `OHMYFLOYD.md` | Fork identity, strategy, workflow | This file. Governs all fork-level decisions. |
| `AGENTS.md` | Development rules for coding-agent | Upstream file with fork-specific additions. |
| `STAGES.md` | ChunkState migration plan | Fork-specific technical document. |
| `patches/rebased/*.patch` | Derived patch artifacts | Regenerated after every rebase. Never hand-edited. |
| `patches/apply-patches.sh` | Patch application script | Updated when patch structure changes. |
| `docs/hooks.md` | Hooks migration guide | Updated by hooks refactor (commit 8). |
| `docs/guides/zai-claude-provider.md` | ZAI provider setup | Fork-specific documentation. |
| `HANDOFF_PROMPT.md` | SUPERSEDED | Historical. Do not follow. |
| `POST_BUILD_HANDOFF.md` | SUPERSEDED | Historical. Do not follow. |
| `docs/porting-from-pi-mono.md` | SUPERSEDED | Historical. Do not follow. |

---

## 10. Recovery

If the repository enters a state where the customization commits are lost, mixed with upstream, or otherwise corrupted:

1. Clone upstream fresh: `git clone https://github.com/can1357/oh-my-pi.git`
2. Apply patches: `bash patches/apply-patches.sh --upstream /path/to/clone`
3. The patches in `patches/rebased/` reconstruct the exact customization state.

This is the disaster recovery path. The patches exist for this purpose. They are tested against fresh upstream clones as part of every rebase cycle.

# OhMyFloyd — Fork of Oh My Pi

> **oh-my-pi upstream (local):** `/Volumes/Storage/oh-my-pi-upstream`
> **oh-my-pi upstream (remote):** `https://github.com/can1357/oh-my-pi`
> **OhMyFloyd fork:** `https://github.com/CaptainPhantasy/OhMyFloyd`

## Dual Repository Workflow

| Task | Use |
|------|-----|
| Daily development | **OhMyFloyd** (`/Volumes/SanDisk1Tb/OhMyFloyd`) |
| Parity with upstream | **oh-my-pi-upstream** (`/Volumes/Storage/oh-my-pi-upstream`) |
| Cherry-pick upstream changes | Pull from oh-my-pi-upstream into OhMyFloyd |
| Full upstream merge | Not recommended — use cherry-pick instead |

## Version State

| Repo | Version | Last Updated |
|------|---------|-------------|
| oh-my-pi-upstream | 14.1.4 | 2026-04-17 |
| OhMyFloyd | 14.2.1 | 2026-04-28 |
| Gap | ~5 versions | |

## Sync Strategy

1. **Do NOT merge upstream into OhMyFloyd directly.** The architectural changes (vim, chunk protocol) break fork customizations.

2. **Cherry-pick selectively.** Run upstream in oh-my-pi-upstream first to validate changes, then cherry-pick safe PRs into OhMyFloyd.

3. **Test before cherry-pick.** Use oh-my-pi-upstream for:
   - Testing new upstream releases
   - Validating bug fixes
   - Previewing new features

## Safe to Cherry-Pick

- Bug fixes (prefixed `fix:`)
- Dependency updates (prefixed `chore(deps):`)
- Documentation improvements
- Non-breaking additions

## Avoid Cherry-Picking

- Architectural rewrites (vim, chunk, extension runtime)
- Deletions of files the fork depends on
- Changes to core tool interfaces
- Breaking changes

## Update Procedure

```bash
# 1. Update local upstream mirror
cd /Volumes/Storage/oh-my-pi-upstream
git pull origin main

# 2. Fetch latest in OhMyFloyd
cd /Volumes/SanDisk1Tb/OhMyFloyd
git fetch upstream

# 3. Review changes in upstream
git log --oneline upstream/main | head -20

# 4. Cherry-pick safe commits as needed
git cherry-pick <commit-hash>
```

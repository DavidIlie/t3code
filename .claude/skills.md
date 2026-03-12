# Skill: Upstream Sync

## Overview
Bring new commits from `pingdotgg/t3code` (upstream) into our fork (`DavidIlie/t3code`).
Every commit is MANUALLY implemented — never cherry-picked. We read the upstream diff, understand
it, and re-implement it carefully against our current codebase.

## Prerequisites
- Remote `upstream` points to `pingdotgg/t3code`
- Remote `origin` points to `DavidIlie/t3code`
- `UPSTREAM.md` tracks the last synced commit hash

## Critical Rules
1. **NEVER cherry-pick or git merge upstream commits.** Always manually implement changes.
2. **NEVER push to GitHub** unless the user explicitly says to. All work stays local.
3. **Take your time.** Thoroughness and correctness over speed. Hours are fine.
4. **Every Codex-specific feature** must also be made to work with Claude Code.
   We support BOTH providers. Analyze the Claude Code adapter and make it work.
5. **Never break existing functionality.** Run typecheck + lint after every commit.
6. **Our Claude Code additions always take priority** over upstream changes in conflicts.

## Workflow

### Step 1: Fetch and list pending commits
```bash
git fetch upstream main
git log --oneline <last-synced-hash>..upstream/main
```

### Step 2: Process each commit (oldest first)
For each upstream commit hash:

1. **Study the commit thoroughly**:
   - `git show <hash> --stat` — see which files changed
   - `git show <hash>` — read the full diff line by line
   - Understand WHY the change was made, not just WHAT changed

2. **Analyze against our codebase**:
   - Read our current versions of the affected files
   - Identify conflicts with our Claude Code additions or other modifications
   - Determine if the change is compatible or needs adaptation

3. **Categorize and decide**:
   - **Universal QOL/bugfix/perf**: Implement the same changes manually in our files
   - **Codex-specific feature**: Implement for Codex AND adapt for Claude Code too.
     Study `ClaudeCodeAdapter.ts`, the Claude Code provider flow, and make the
     equivalent feature work for Claude sessions.
   - **CI/infra change**: Evaluate against our release flow. Usually skip (we have our own).
   - **Formatting-only**: Apply if compatible with our code state
   - **Conflicts with our work**: Manually merge, keeping our additions intact

4. **Implement manually**: Edit files directly using the Edit tool. Never cherry-pick.

5. **Verify after each commit**: `bun typecheck && bun lint`

6. **Update UPSTREAM.md**: Move commit to Integrated or Skipped section with notes

### Step 3: After processing a batch of commits
1. Run full verification: `bun typecheck && bun lint && bun run test`
2. Update "Last Synced Commit" in UPSTREAM.md to the latest processed hash
3. Commit UPSTREAM.md update
4. **DO NOT push** — wait for user to say when

## Claude Code Adaptation Guide
When encountering Codex-specific features, check these files to understand
how to make equivalent functionality work for Claude:
- `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` — Claude Code session lifecycle
- `apps/server/src/provider/Services/ProviderService.ts` — Provider abstraction layer
- `apps/server/src/provider/Services/ProviderSessionDirectory.ts` — Session bindings
- `packages/contracts/src/orchestration.ts` — Shared event/session schemas
- `apps/server/src/codexAppServerManager.ts` — Codex equivalent (for comparison)

The goal: if a Codex user gets feature X, a Claude Code user should get the
equivalent experience adapted to Claude's SDK and capabilities.

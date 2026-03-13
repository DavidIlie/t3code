# Upstream Sync Tracker

Upstream: https://github.com/pingdotgg/t3code
Fork: https://github.com/DavidIlie/t3code

## Last Synced Commit

`dcd2e5c3` — fix: don't restart the app on normal exits in dev runner (2026-03-12)

## Pending Upstream Commits

<!-- Updated by running: git log --oneline dcd2e5c3..upstream/main -->
<!-- Each commit gets moved to Integrated or Skipped after processing -->

None — fully synced with upstream/main.

## Integrated

- `8282b11f` — refactor(contracts): remove unused OrchestrationPersistedEvent schema
- `75ca0d4f` — Open folder picker immediately on desktop Electron
- `5c286cab` — Open project folder picker immediately in Electron (covered by 75ca0d4f)
- `ce7b24bf` — Inline Electron project picker check in Sidebar (covered by 75ca0d4f)
- `b0e1b336` — Show toast when immediate project add fails
- `b030f69a` — Show Awaiting Input status in sidebar and extract status logic
- `b946f00f` — Show Plan Ready status pill for settled plan threads
- `081a6dac` — Remove fast-tier icons from model selection UI
- `9fdb45be` — Remove service tier setting from Codex flow and contracts
- `24122b17` — Stabilize toast stacking offsets to prevent hover flicker
- `f6238109` — Adapt composer footer to compact controls on narrow widths
- `993b5785` — Use form clientWidth for composer compact footer checks
- `e354e869` — Prevent compact diff sidebar from breaking chat composer layout
- `7a3d4d1f` — Stabilize onToggleRuntimeMode with useCallback
- `90e0c2ab` — perf: debounce composer draft localStorage writes
- `7a377fc5` — perf: debounce Zustand store persistence and deduplicate legacy cleanup
- `296eb82c` — perf: throttle domain event processing with 100ms batch window
- `6593645c` — perf: run provider health checks in background, notify clients on ready
- `074d3af7` — cleanup: use Effect Fiber for background provider health checks
- `1f47cc6f` — Remove ProviderHealth onReady callback from service interface
- `e765051f` — perf: use Debouncer for store persistence (covered by 7a377fc5)
- `5e66ab88` — perf: use Debouncer for composer draft storage (covered by 90e0c2ab)
- `f5e4df5c` — perf: use Throttler for domain events (covered by 296eb82c)
- `2f5e6260` — Fix project name badge truncation
- `bb49ebf6` — Add drag-and-drop project reordering in the sidebar
- `a6b22ec1` — Fix project drag clicks and sidebar collapse/scroll behavior
- `b5dde6b9` — Prevent stale click suppression after project drag cancel
- `3503dbc7` — Pin vite
- `f9c3aff2` — Remove experimental tsconfig aliases flag
- `e4203648` — Improve project drag collision detection
- `9fb9467e` — Keep suppressProjectClickAfterDragRef on drag cancel
- `eb7c428a` — Defer proposed plan rendering until expand
- `3a86b606` — Render collapsed plan preview directly as markdown
- `2fc0b01c` — fmt (max-width class cleanup)
- `99dbe4ff` — Disable add project button for empty path
- `4ed89e4b` — Treat retryable Codex errors as runtime warnings
- `dcccca3f` — Fix UI overflow for commit/push PR label
- `9d2c2cae` — Polyfill crypto.randomUUID for non-secure HTTP contexts
- `767de271` — Use Effect UUID generator as randomUUID fallback
- `3d358680`..`d28ced8f` — PR checkout/worktree workflow (13 commits)
- `9309edf4` — rm test (cleanup removed checkout-pr test)
- `afb6e89b` — Shift-click multi-select for sidebar threads
- `223c3dc8` — Add and apply fmt:check script
- `b8d07eb8` — Add downloads page and shared marketing layout (marketing only)
- `9e891d2e` — Display application version in sidebar and settings
- `2c351726` — fix(contracts): align terminal restart input type across IPC, WS, and server
- `9becb3f4` — fix(server): skip auth check when Codex CLI uses a custom model provider
- `1c290767` — fix: use commit as the default git action without origin
- `1e9bac7f` — Sync desktop native theme with web theme setting
- `13eeb07f` — prevent squashing some known errors
- `b37279ca` — fix: prevent Codex overrides footer overflow with long binary paths
- `dfd41da2` — Fix Windows keybindings for font size: use Ctrl+ to increase
- `ddd98876` — fix: invalidate workspace entry cache after turn completion and revert
- `1031a226` — Fix cross-repo PR detection and push remote selection
- `7d115334` — Stabilize runtime orchestration and fix flaky CI tests
- `065ef922` — Require bun fmt for completion and clarify Electron history
- `90d9a2ad` — fix: map gitignore to ini for Shiki syntax highlighting
- `e8b01263` — fix: checkpoint diffs never resolve (shared PubSub subscription)
- `7ddcb239` — feat: persist diff panel state across thread navigation
- `e3d46b68` — feat: split out components from ChatView.tsx
- `ff6a66dc` — Use live thread activities for sidebar status pills
- `a01d7127` — fix(web): resolve preferred editor from available editors & useLocalStorage
- `a33cc8c7` — fix: diff panel unclosable after retainSearchParams middleware
- `c3bfcc36` — feat: add selective file staging to commit dialog
- `ed4be2c8` — fix: Fix response duration for agent to no longer always be 1ms
- `b60a34eb` — fix: fix logo alignment regression on macOS
- `ab0002f9` — update project removal copy
- `fcbf3f3c` — Fix new-thread shortcuts when terminal is focused
- `c52ad29b` — Fix mod+N new thread flow and terminal split limits
- `f63cda22` — fix: improve business logic in prompt editor and fix cursor bugs in Plan mode
- `224acebb` — fix(web): add pointer cursor to running stop-generation button
- `85c174a6` — fix: Linux icon now shows up
- `b6eba334` — fix: add logging for WebSocket errors
- `724f54c2` — fix: clean up timeout in PlanSidebar to prevent memory leaks
- `b496ae83` — fix: add error logging for code highlighting failures
- `1e276573` — feat: add fuzzy workspace entry search
- `dcd2e5c3` — fix: don't restart the app on normal exits in dev runner (already implemented)

## Skipped

- `47117a7d` — Inline SidebarInset base classes (already done in our codebase)
- `ed518ef1` — Fix provider picker after rebase (removes serviceTierSetting we never added)
- `bbab1fc8` — chore(release): prepare v0.0.10 (version bump — we have our own versioning)
- `2ac73565` — chore(release): align package versions before building artifacts (release infra)
- `82a50da8` — revert formatting on mockServiceWorker.js (formatting only)
- `9e4e2219` — chore: added eggfriedrice24 to vouched list (upstream-specific)
- `774cff9a` — ci(github): add pull request size labels (upstream CI)
- `8636ea0e` — Add maria-rcks to the list of contributors (upstream-specific)
- `5e23e9c7` — add Ymit24 to vouched list (upstream-specific)
- `74c22628` — chore: update actions/checkout and actions/github-script (upstream CI)
- `581d2429` — remove triggers (upstream CI)
- `d9d0216e` — fix pr size workflow (upstream CI)
- `db17ff33` — fix syntax errors from bad merge (already correct in our codebase)

# Upstream Sync Tracker

Upstream: https://github.com/pingdotgg/t3code
Fork: https://github.com/DavidIlie/t3code

## Last Synced Commit

`223c3dc8` — chore(ci): add and apply fmt:check script (2026-03-10)

## Pending Upstream Commits

<!-- Updated by running: git log --oneline 223c3dc8..upstream/main -->
<!-- Each commit gets moved to Integrated or Skipped after processing -->

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
- `3d358680`..`d28ced8f` — PR checkout/worktree workflow (13 commits: PR checkout UI, branch picker enhancements, fork PR handling, worktree integration, Effect Schema decoders, branch collision avoidance, dialog migration)
- `9309edf4` — rm test (cleanup removed checkout-pr test)
- `afb6e89b` — Shift-click multi-select for sidebar threads
- `223c3dc8` — Add and apply fmt:check script

## Skipped

- `47117a7d` — Inline SidebarInset base classes (already done in our codebase)
- `ed518ef1` — Fix provider picker after rebase (removes serviceTierSetting we never added)

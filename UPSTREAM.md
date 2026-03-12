# Upstream Sync Tracker

Upstream: https://github.com/pingdotgg/t3code
Fork: https://github.com/DavidIlie/t3code

## Last Synced Commit

`1f47cc6f` — Remove ProviderHealth onReady callback from service interface (2026-03-09)

## Pending Upstream Commits

<!-- Updated by running: git log --oneline 1f47cc6f..upstream/main -->
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

## Skipped

- `47117a7d` — Inline SidebarInset base classes (already done in our codebase)
- `ed518ef1` — Fix provider picker after rebase (removes serviceTierSetting we never added)

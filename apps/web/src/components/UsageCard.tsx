import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import type { ProviderKind } from "@t3tools/contracts";
import {
  useProviderSessionStore,
  type ProviderUsageSnapshot,
  type UsageTier,
} from "../providerSessionStore";
import { useStore } from "../store";
import { readNativeApi } from "../nativeApi";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { SidebarMenuButton } from "./ui/sidebar";

// ── Helpers ──────────────────────────────────────────────────────────

type Severity = "ok" | "warning" | "critical";

function severityFromPercent(pct: number): Severity {
  if (pct >= 90) return "critical";
  if (pct >= 70) return "warning";
  return "ok";
}

function dotColor(status: Severity): string {
  switch (status) {
    case "ok":
      return "bg-primary";
    case "warning":
      return "bg-amber-500";
    case "critical":
      return "bg-red-500";
  }
}

function barFillColor(status: Severity): string {
  switch (status) {
    case "ok":
      return "bg-primary/80";
    case "warning":
      return "bg-amber-500/80";
    case "critical":
      return "bg-red-500/80";
  }
}

function formatResetTime(resetAt: string | null): string | null {
  if (!resetAt) return null;
  try {
    const date = new Date(resetAt);
    const diff = date.getTime() - Date.now();
    if (diff <= 0) return "Resetting...";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours >= 24) {
      const fmt = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      return `Resets ${fmt.format(date)}`;
    }
    if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
    return `Resets in ${minutes}m`;
  } catch {
    return null;
  }
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ── Rate-limit event parsing (for SDK events fallback) ──────────────

const SDK_TIER_LABEL_MAP: Record<string, string> = {
  five_hour: "Session (5h)",
  seven_day: "Weekly",
  seven_day_opus: "Opus",
  seven_day_sonnet: "Sonnet",
  overage: "Extra usage",
};

/**
 * Parse rate limit information from either:
 * - Claude SDK `rate_limit_event` messages (with `rate_limit_info`)
 * - Codex `account/rateLimits/updated` events (with nested objects)
 */
export function parseRateLimitPayload(
  provider: ProviderKind,
  raw: unknown,
): ProviderUsageSnapshot {
  const now = new Date().toISOString();
  const tiers: UsageTier[] = [];
  let plan: string | null = null;
  let extraUsage: ProviderUsageSnapshot["extraUsage"] = null;

  if (raw && typeof raw === "object") {
    const data = raw as Record<string, unknown>;
    plan = typeof data.plan === "string" ? data.plan : null;

    // Server periodic push format: { available, plan, tiers: [{key, label, utilization, resetsAt}], extraUsage, error }
    if (Array.isArray(data.tiers)) {
      for (const t of data.tiers) {
        if (t && typeof t === "object") {
          const tier = t as Record<string, unknown>;
          const pct = typeof tier.utilization === "number" ? tier.utilization : 0;
          tiers.push({
            label: typeof tier.label === "string" ? tier.label : String(tier.key ?? "unknown"),
            percentUsed: pct,
            resetAt: typeof tier.resetsAt === "string" ? tier.resetsAt : null,
            status: severityFromPercent(pct),
          });
        }
      }
      if (data.extraUsage && typeof data.extraUsage === "object") {
        const e = data.extraUsage as Record<string, unknown>;
        extraUsage = {
          spent: typeof e.spent === "number" ? e.spent : 0,
          limit: typeof e.limit === "number" ? e.limit : 0,
        };
      }
      return { provider, plan, tiers, extraUsage, updatedAt: now, raw };
    }

    // Claude SDK rate_limit_event: { type: "rate_limit_event", rate_limit_info: { utilization, rateLimitType, resetsAt, status } }
    const rateLimitInfo = data.rate_limit_info;
    if (rateLimitInfo && typeof rateLimitInfo === "object") {
      const info = rateLimitInfo as Record<string, unknown>;
      const utilization = typeof info.utilization === "number" ? info.utilization : null;
      if (utilization !== null) {
        const pct = utilization <= 1 ? utilization * 100 : utilization;
        const tierType = typeof info.rateLimitType === "string" ? info.rateLimitType : "unknown";
        const label = SDK_TIER_LABEL_MAP[tierType] ?? tierType;
        // resetsAt from SDK is a unix timestamp (number), not an ISO string
        let resetAt: string | null = null;
        if (typeof info.resetsAt === "number") {
          resetAt = new Date(info.resetsAt * 1000).toISOString();
        } else if (typeof info.resetsAt === "string") {
          resetAt = info.resetsAt;
        }
        tiers.push({
          label,
          percentUsed: pct,
          resetAt,
          status: severityFromPercent(pct),
        });
      }
      return { provider, plan, tiers, extraUsage, updatedAt: now, raw };
    }

    // Codex / generic format: nested objects with percentUsed, utilization, or used/limit
    const limits = (data.limits ?? data.rateLimits ?? data) as Record<string, unknown>;
    if (typeof limits === "object" && limits !== null) {
      for (const [key, val] of Object.entries(limits)) {
        if (val && typeof val === "object") {
          const v = val as Record<string, unknown>;
          const pct =
            typeof v.percentUsed === "number"
              ? v.percentUsed
              : typeof v.utilization === "number"
                ? v.utilization
                : typeof v.used === "number" &&
                    typeof v.limit === "number" &&
                    (v.limit as number) > 0
                  ? Math.round(((v.used as number) / (v.limit as number)) * 100)
                  : null;
          if (pct !== null) {
            tiers.push({
              label: key.charAt(0).toUpperCase() + key.slice(1),
              percentUsed: pct,
              resetAt: typeof v.resetAt === "string" ? v.resetAt : null,
              status: severityFromPercent(pct),
            });
          }
        }
      }
    }
  }

  return { provider, plan, tiers, extraUsage, updatedAt: now, raw };
}

// ── Sub-components ───────────────────────────────────────────────────

function TierRow({ tier }: { tier: UsageTier }) {
  const severity = tier.status;
  const resetLabel = formatResetTime(tier.resetAt);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-foreground">{tier.label}</span>
        <span className={`size-1.5 rounded-full ${dotColor(severity)}`} />
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barFillColor(severity)}`}
          style={{ width: `${Math.min(tier.percentUsed, 100)}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[10px] text-muted-foreground/70">
        <span>{Math.round(tier.percentUsed)}%</span>
        {resetLabel && <span>{resetLabel}</span>}
      </div>
    </div>
  );
}

function ExtraUsageRow({ spent, limit }: { spent: number; limit: number }) {
  const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-foreground">Extra usage spent</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-purple-500/80 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[10px] text-muted-foreground/70">
        <span>${spent.toFixed(2)}</span>
        <span>${limit.toFixed(2)} limit</span>
      </div>
    </div>
  );
}

/** Tiers shown by default — everything else is collapsed behind "Show more". */
const PRIMARY_TIER_LABELS = new Set(["Session (5h)", "Weekly"]);

function ProviderUsageContent({ snapshot }: { snapshot: ProviderUsageSnapshot | undefined }) {
  const [expanded, setExpanded] = useState(false);

  if (!snapshot || snapshot.tiers.length === 0) {
    const errorMessage = snapshot?.raw
      ? (snapshot.raw as Record<string, unknown>).error
      : undefined;
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 py-4 text-center">
        <ActivityIcon className="size-5 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground/60">
          {errorMessage ? "Usage unavailable" : "No usage data yet"}
        </p>
        <p className="text-[10px] text-muted-foreground/40">
          {typeof errorMessage === "string"
            ? errorMessage
            : "Usage data will appear once providers connect."}
        </p>
      </div>
    );
  }

  const primaryTiers = snapshot.tiers.filter((t) => PRIMARY_TIER_LABELS.has(t.label));
  const secondaryTiers = snapshot.tiers.filter((t) => !PRIMARY_TIER_LABELS.has(t.label));
  const hasSecondary = secondaryTiers.length > 0 || snapshot.extraUsage != null;

  return (
    <div className="space-y-3">
      {primaryTiers.map((tier) => (
        <TierRow key={tier.label} tier={tier} />
      ))}
      {expanded && (
        <>
          {secondaryTiers.map((tier) => (
            <TierRow key={tier.label} tier={tier} />
          ))}
          {snapshot.extraUsage && (
            <ExtraUsageRow spent={snapshot.extraUsage.spent} limit={snapshot.extraUsage.limit} />
          )}
        </>
      )}
      {hasSecondary && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1 rounded-md py-0.5 text-[10px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              Show less <ChevronUpIcon className="size-3" />
            </>
          ) : (
            <>
              Show {secondaryTiers.length + (snapshot.extraUsage ? 1 : 0)} more <ChevronDownIcon className="size-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function UsageCard() {
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderKind>("claudeCode");
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);

  const usageByProvider = useProviderSessionStore((s) => s.usageByProvider);
  const threads = useStore((s) => s.threads);

  // Detect active providers
  const activeProviders = useMemo(() => {
    const providers = new Set<ProviderKind>();
    for (const thread of threads) {
      if (thread.session?.status === "running" || thread.session?.status === "ready") {
        providers.add(thread.session.provider);
      }
    }
    for (const key of Object.keys(usageByProvider) as ProviderKind[]) {
      providers.add(key);
    }
    // Always show claudeCode
    providers.add("claudeCode");
    return providers;
  }, [threads, usageByProvider]);

  // Tick every minute for relative times
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);

  // Core fetch — stores the result without touching spinner state
  const fetchUsage = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    try {
      const result = await api.provider.getUsage();
      const store = useProviderSessionStore.getState();
      if (result.claudeCode.available || result.claudeCode.tiers.length > 0) {
        store.setProviderUsage("claudeCode", {
          provider: "claudeCode",
          plan: result.claudeCode.plan,
          tiers: result.claudeCode.tiers.map((t) => ({
            label: t.label,
            percentUsed: t.utilization,
            resetAt: t.resetsAt,
            status: severityFromPercent(t.utilization),
          })),
          extraUsage: result.claudeCode.extraUsage
            ? { spent: result.claudeCode.extraUsage.spent, limit: result.claudeCode.extraUsage.limit }
            : null,
          updatedAt: new Date().toISOString(),
          raw: result.claudeCode,
        });
      }
    } catch {
      // Non-critical
    }
  }, []);

  // Manual refresh (shows spinner)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchUsage();
    } finally {
      setRefreshing(false);
    }
  }, [fetchUsage]);

  // Auto-fetch on mount and every 2 minutes
  useEffect(() => {
    void fetchUsage();
    const id = setInterval(() => void fetchUsage(), 120_000);
    return () => clearInterval(id);
  }, [fetchUsage]);

  const currentSnapshot = usageByProvider[activeProvider];
  const plan = currentSnapshot?.plan ?? null;

  // Overall status for sidebar dot
  const overallStatus = useMemo((): Severity | null => {
    // Check all providers
    let maxUtil = 0;
    for (const snapshot of Object.values(usageByProvider)) {
      if (snapshot) {
        for (const tier of snapshot.tiers) {
          maxUtil = Math.max(maxUtil, tier.percentUsed);
        }
      }
    }
    if (maxUtil === 0) return null;
    return severityFromPercent(maxUtil);
  }, [usageByProvider]);

  const sidebarDotClass = overallStatus ? dotColor(overallStatus) : "bg-muted-foreground/30";

  const handleProviderClick = useCallback(
    (p: ProviderKind) => () => setActiveProvider(p),
    [],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
          />
        }
      >
        <div className="relative">
          <ActivityIcon className="size-3.5" />
          <span
            className={`absolute -right-0.5 -top-0.5 size-1.5 rounded-full ${sidebarDotClass}`}
          />
        </div>
        <span className="text-xs">Usage</span>
      </PopoverTrigger>
      <PopoverPopup side="right" align="end" sideOffset={16} className="w-72">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {activeProvider === "claudeCode"
                  ? "Claude"
                  : activeProvider === "codex"
                    ? "Codex"
                    : "Cursor"}
              </span>
              {plan && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {plan}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {activeProvider === "claudeCode" && (
                <a
                  href="https://console.anthropic.com/settings/usage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-md border border-input px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Console <ExternalLinkIcon className="size-2.5" />
                </a>
              )}
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                title="Refresh"
              >
                <RefreshCwIcon className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Provider tabs */}
          {activeProviders.size > 1 && (
            <div className="flex gap-1">
              {(["claudeCode", "codex", "cursor"] as const)
                .filter((p) => activeProviders.has(p))
                .map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      activeProvider === p
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground/60 hover:text-muted-foreground"
                    }`}
                    onClick={handleProviderClick(p)}
                  >
                    {p === "claudeCode" ? "Claude" : p === "codex" ? "Codex" : "Cursor"}
                  </button>
                ))}
            </div>
          )}

          {/* Usage content */}
          <ProviderUsageContent snapshot={currentSnapshot} />

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground/40">
            <span>T3 Gurt</span>
            {currentSnapshot?.updatedAt && (
              <span>Updated {formatTimeAgo(currentSnapshot.updatedAt)}</span>
            )}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

// ── Persistent sidebar usage bars ─────────────────────────────────────

function CompactTierBar({ tier }: { tier: UsageTier }) {
  const severity = tier.status;
  const resetLabel = formatResetTime(tier.resetAt);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/70">{tier.label}</span>
        <span className="text-[10px] text-muted-foreground/50">{Math.round(tier.percentUsed)}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted/60">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barFillColor(severity)}`}
          style={{ width: `${Math.min(tier.percentUsed, 100)}%` }}
        />
      </div>
      {resetLabel && (
        <p className="text-[9px] text-muted-foreground/40">{resetLabel}</p>
      )}
    </div>
  );
}

export function SidebarUsageBars() {
  const usageByProvider = useProviderSessionStore((s) => s.usageByProvider);
  const lastTiersRef = useRef<UsageTier[]>([]);

  const allTiers: UsageTier[] = [];
  const claude = usageByProvider.claudeCode;
  if (claude) {
    for (const t of claude.tiers) {
      if (PRIMARY_TIER_LABELS.has(t.label)) allTiers.push(t);
    }
  }
  const codex = usageByProvider.codex;
  if (codex) {
    for (const t of codex.tiers) {
      allTiers.push({ ...t, label: `Codex ${t.label}` });
    }
  }

  // Keep last-known tiers visible to prevent layout flashing when data resets momentarily.
  const displayTiers = allTiers.length > 0 ? allTiers : lastTiersRef.current;
  if (allTiers.length > 0) {
    lastTiersRef.current = allTiers;
  }

  if (displayTiers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5 px-2 py-1.5">
      {displayTiers.map((tier) => (
        <CompactTierBar key={tier.label} tier={tier} />
      ))}
    </div>
  );
}

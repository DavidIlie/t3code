import { useMemo } from "react";
import { useProviderSessionStore } from "../providerSessionStore";
import { useStore } from "../store";

function planLabel(account: Record<string, unknown>): string | null {
  // Try common shapes from Claude Code's AccountInfo
  const plan =
    typeof account.plan === "string"
      ? account.plan
      : typeof account.membershipTier === "string"
        ? account.membershipTier
        : typeof account.tier === "string"
          ? account.tier
          : null;
  if (!plan) return null;
  // Capitalize first letter
  return plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase();
}

function planColorClass(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("max")) return "bg-purple-500/15 text-purple-600 dark:text-purple-400";
  if (lower.includes("pro")) return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  if (lower.includes("team")) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (lower.includes("enterprise")) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

export default function AccountPill() {
  const threads = useStore((s) => s.threads);
  const accountByThread = useProviderSessionStore((s) => s.accountByThread);

  const latestAccount = useMemo(() => {
    // Find the most recent active thread's account info
    for (const thread of threads) {
      if (thread.session?.status === "running" || thread.session?.status === "ready") {
        const account = accountByThread[thread.id];
        if (account) return account;
      }
    }
    // Fall back to any thread with account info
    for (const thread of threads) {
      const account = accountByThread[thread.id];
      if (account) return account;
    }
    return null;
  }, [threads, accountByThread]);

  if (!latestAccount) return null;

  const label = planLabel(latestAccount);
  if (!label) return null;

  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${planColorClass(label)}`}
    >
      {label}
    </span>
  );
}

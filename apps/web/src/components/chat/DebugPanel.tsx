import type { OrchestrationThreadActivity, ProviderKind, TurnId } from "@t3tools/contracts";
import { memo, useState } from "react";
import { BugIcon, ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import type { Thread, ThreadSession } from "~/types";
import { formatDuration } from "~/session-logic";
import { isElectron } from "~/env";

interface DebugPanelProps {
  thread: Thread;
  onClose: () => void;
}

function formatProviderLabel(provider: ProviderKind): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claudeCode":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    default:
      return provider;
  }
}

function formatSessionStatus(session: ThreadSession | null): string {
  if (!session) return "No session";
  return `${session.orchestrationStatus} (${session.status})`;
}

function extractUsageFromActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
): { inputTokens?: number; outputTokens?: number; totalCostUsd?: number } | null {
  const turnActivities = latestTurnId
    ? activities.filter((a) => a.turnId === latestTurnId)
    : activities;

  for (const activity of turnActivities.toReversed()) {
    const payload = activity.payload as Record<string, unknown> | null;
    if (!payload) continue;

    if (payload.usage && typeof payload.usage === "object") {
      const usage = payload.usage as Record<string, unknown>;
      const result: { inputTokens?: number; outputTokens?: number; totalCostUsd?: number } = {};
      if (typeof usage.input_tokens === "number") result.inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === "number") result.outputTokens = usage.output_tokens;
      if (typeof payload.totalCostUsd === "number") result.totalCostUsd = payload.totalCostUsd;
      return result;
    }
  }
  return null;
}

export const DebugPanel = memo(function DebugPanel({ thread, onClose }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const session = thread.session;
  const latestTurn = thread.latestTurn;
  const turnUsage = extractUsageFromActivities(thread.activities, latestTurn?.turnId ?? undefined);

  const turnDuration =
    latestTurn?.startedAt && latestTurn?.completedAt
      ? new Date(latestTurn.completedAt).getTime() - new Date(latestTurn.startedAt).getTime()
      : null;

  return (
    <div
      className={`absolute right-2 z-50 w-72 rounded-lg border border-border/60 bg-popover/95 shadow-lg backdrop-blur-sm text-xs ${isElectron ? "top-[58px]" : "top-2"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <BugIcon className="size-3" />
          <span className="font-medium text-[11px]">Debug</span>
          {expanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
        </button>
        <div className="flex items-center gap-2">
          {session && (
            <span className="text-[10px] text-muted-foreground/60">
              {formatProviderLabel(session.provider)}
            </span>
          )}
          <button
            type="button"
            className="text-muted-foreground/50 hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      </div>

      {/* Collapsed summary row */}
      {!expanded && (
        <div className="space-y-1 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-[10px] text-muted-foreground/50">Status</span>
            <span className="text-[10px] text-muted-foreground/80">
              {formatSessionStatus(session)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-[10px] text-muted-foreground/50">Model</span>
            <span className="truncate text-[10px] font-mono text-muted-foreground/80">
              {thread.model || "default"}
            </span>
          </div>
          {latestTurn && (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-[10px] text-muted-foreground/50">Turn</span>
              <span className="text-[10px] text-muted-foreground/80">
                {latestTurn.state ?? "—"}
                {turnDuration !== null && ` · ${formatDuration(turnDuration)}`}
              </span>
            </div>
          )}
          {(turnUsage?.inputTokens !== undefined || turnUsage?.outputTokens !== undefined) && (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-[10px] text-muted-foreground/50">Tokens</span>
              <span className="text-[10px] font-mono text-muted-foreground/80">
                {turnUsage?.inputTokens !== undefined &&
                  `${turnUsage.inputTokens.toLocaleString()} in`}
                {turnUsage?.inputTokens !== undefined &&
                  turnUsage?.outputTokens !== undefined &&
                  " · "}
                {turnUsage?.outputTokens !== undefined &&
                  `${turnUsage.outputTokens.toLocaleString()} out`}
              </span>
            </div>
          )}
          {turnUsage?.totalCostUsd !== undefined && (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-[10px] text-muted-foreground/50">Cost</span>
              <span className="text-[10px] font-mono text-muted-foreground/80">
                ${turnUsage.totalCostUsd.toFixed(4)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-[10px] text-muted-foreground/50">Runtime</span>
            <span className="text-[10px] text-muted-foreground/80">{thread.runtimeMode}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-[10px] text-muted-foreground/50">Messages</span>
            <span className="text-[10px] text-muted-foreground/80">{thread.messages.length}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-[10px] text-muted-foreground/50">Activities</span>
            <span className="text-[10px] text-muted-foreground/80">
              {thread.activities.length}
            </span>
          </div>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-2 px-3 py-2">
          {/* Session info */}
          <Section title="Session">
            <Row
              label="Provider"
              value={session ? formatProviderLabel(session.provider) : "none"}
            />
            <Row label="Status" value={formatSessionStatus(session)} />
            <Row label="Model" value={thread.model || "default"} />
            <Row label="Runtime" value={thread.runtimeMode} />
            <Row label="Interaction" value={thread.interactionMode} />
            {session?.lastError && (
              <Row label="Error" value={session.lastError} className="text-red-400" />
            )}
          </Section>

          {/* Turn info */}
          {latestTurn && (
            <Section title="Latest Turn">
              <Row label="Turn ID" value={latestTurn.turnId ?? "—"} mono />
              <Row label="Status" value={latestTurn.state ?? "—"} />
              {turnDuration !== null && (
                <Row label="Duration" value={formatDuration(turnDuration)} />
              )}
              {latestTurn.startedAt && (
                <Row label="Started" value={new Date(latestTurn.startedAt).toLocaleTimeString()} />
              )}
            </Section>
          )}

          {/* Usage */}
          {turnUsage && (
            <Section title="Usage (Latest Turn)">
              {turnUsage.inputTokens !== undefined && (
                <Row label="Input tokens" value={turnUsage.inputTokens.toLocaleString()} />
              )}
              {turnUsage.outputTokens !== undefined && (
                <Row label="Output tokens" value={turnUsage.outputTokens.toLocaleString()} />
              )}
              {turnUsage.totalCostUsd !== undefined && (
                <Row label="Cost" value={`$${turnUsage.totalCostUsd.toFixed(4)}`} />
              )}
            </Section>
          )}

          {/* Thread info */}
          <Section title="Thread">
            <Row label="ID" value={thread.id} mono />
            <Row label="Messages" value={String(thread.messages.length)} />
            <Row label="Activities" value={String(thread.activities.length)} />
            <Row label="Turns" value={String(thread.turnDiffSummaries.length)} />
            {thread.branch && <Row label="Branch" value={thread.branch} mono />}
            {thread.worktreePath && <Row label="Worktree" value={thread.worktreePath} mono />}
          </Section>
        </div>
      )}
    </div>
  );
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-muted-foreground/50">{label}</span>
      <span
        className={`min-w-0 truncate text-right text-muted-foreground/80 ${mono ? "font-mono" : ""} ${className ?? ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

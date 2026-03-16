import { memo } from "react";
import { cn } from "~/lib/utils";
import type { ProviderUsageSnapshot } from "../../providerSessionStore";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuPopup, MenuTrigger } from "../ui/menu";
import { ProviderUsageContent } from "../UsageCard";

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function deriveHighestPercent(snapshot: ProviderUsageSnapshot | null): number | null {
  const tiers = snapshot?.tiers;
  if (!tiers || tiers.length === 0) return null;
  let highest = 0;
  for (const t of tiers) {
    if (t.percentUsed > highest) highest = t.percentUsed;
  }
  return highest;
}

type Severity = "ok" | "warning" | "danger";

function deriveSeverity(percent: number | null): Severity {
  if (percent === null) return "ok";
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "ok";
}

export const ComposerContextUsageIndicator = memo(function ComposerContextUsageIndicator({
  snapshot,
}: {
  snapshot: ProviderUsageSnapshot | null;
}) {
  const highestPercent = deriveHighestPercent(snapshot);
  const severity = deriveSeverity(highestPercent);
  const ringToneClass =
    severity === "danger"
      ? "stroke-rose-500"
      : severity === "warning"
        ? "stroke-amber-500"
        : "stroke-muted-foreground/80";
  const dashOffset =
    highestPercent === null
      ? RING_CIRCUMFERENCE
      : RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(highestPercent, 100)) / 100);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            aria-label="Usage"
            className="relative inline-flex size-7 shrink-0 px-0 text-muted-foreground/75 hover:text-foreground/80"
          />
        }
      >
        <svg
          aria-hidden="true"
          className="size-4 -rotate-90"
          viewBox="0 0 16 16"
          fill="none"
          focusable="false"
        >
          <circle
            cx="8"
            cy="8"
            r={RING_RADIUS}
            className="stroke-border/80"
            strokeWidth="1.5"
            fill="none"
          />
          {highestPercent !== null ? (
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              className={cn("transition-[stroke-dashoffset,stroke] duration-200", ringToneClass)}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              fill="none"
            />
          ) : null}
        </svg>
      </MenuTrigger>
      <MenuPopup side="top" align="start" className="max-w-72">
        <MenuGroup>
          <div className="px-2 py-1.5">
            <ProviderUsageContent snapshot={snapshot ?? undefined} />
          </div>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});

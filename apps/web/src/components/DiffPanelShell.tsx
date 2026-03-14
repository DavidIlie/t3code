import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

export type DiffPanelMode = "inline" | "sheet" | "sidebar";

export function getDiffPanelHeaderRowClassName(mode: DiffPanelMode): string {
  return cn(
    "flex items-center gap-2 border-b border-border px-3 py-2",
    mode !== "inline" && isElectron ? "app-region-drag" : "",
  );
}

export function DiffPanelShell({
  mode,
  children,
  header,
}: {
  mode: DiffPanelMode;
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {header ? (
        <div className={getDiffPanelHeaderRowClassName(mode)}>{header}</div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function DiffPanelHeaderSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-4 w-16 animate-pulse rounded bg-muted" />
    </div>
  );
}

export function DiffPanelLoadingState({ mode }: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={mode} header={<DiffPanelHeaderSkeleton />}>
      <div
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
        role="status"
        aria-label="Loading diff"
      >
        Loading diff…
      </div>
    </DiffPanelShell>
  );
}

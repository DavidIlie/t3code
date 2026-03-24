/**
 * Git History Panel — Stub
 *
 * The git log/commit-diff WS methods were removed in the upstream sync.
 * This panel needs to be rebuilt on top of the new git architecture.
 */
export default function GitHistoryPanel({ mode: _mode }: { mode: "sheet" | "inline" }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground/50">
      Git history is being rebuilt.
    </div>
  );
}

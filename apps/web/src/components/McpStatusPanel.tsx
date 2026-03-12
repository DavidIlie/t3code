import { useMemo } from "react";
import {
  ServerIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
  useProviderSessionStore,
  type McpServerInfo,
} from "../providerSessionStore";
import { useStore } from "../store";

function statusBadge(status: string) {
  switch (status) {
    case "connected":
      return {
        icon: CheckCircleIcon,
        className: "text-green-500",
        label: "Connected",
      };
    case "failed":
    case "error":
      return {
        icon: XCircleIcon,
        className: "text-red-500",
        label: "Failed",
      };
    case "disabled":
      return {
        icon: AlertCircleIcon,
        className: "text-muted-foreground/50",
        label: "Disabled",
      };
    case "configured":
      return {
        icon: ServerIcon,
        className: "text-blue-500",
        label: "Configured",
      };
    default:
      return {
        icon: RefreshCwIcon,
        className: "text-amber-500 animate-spin",
        label: status,
      };
  }
}

export default function McpStatusPanel() {
  const threads = useStore((s) => s.threads);
  const mcpStatusByThread = useProviderSessionStore(
    (s) => s.mcpStatusByThread,
  );
  const globalMcpServers = useProviderSessionStore(
    (s) => s.globalMcpServers,
  );

  // Aggregate MCP servers from all active threads, with global config as fallback
  const allServers = useMemo(() => {
    const serverMap = new Map<string, McpServerInfo>();
    // Start with global configured servers
    for (const server of globalMcpServers) {
      serverMap.set(server.name, server);
    }
    // Override with live per-thread status (connected/failed etc.)
    for (const thread of threads) {
      const status = mcpStatusByThread[thread.id];
      if (!status) continue;
      for (const server of status) {
        serverMap.set(server.name, server);
      }
    }
    return [...serverMap.values()];
  }, [threads, mcpStatusByThread, globalMcpServers]);

  if (allServers.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ServerIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">MCP Servers</h3>
        </div>
        <p className="text-xs text-muted-foreground/60">
          No MCP servers detected. Start a Claude Code session with MCP servers
          configured to see their status here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <ServerIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">MCP Servers</h3>
        <span className="ml-auto text-[10px] text-muted-foreground/50">
          {allServers.length} server{allServers.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {allServers.map((server) => {
          const badge = statusBadge(server.status);
          const BadgeIcon = badge.icon;
          return (
            <div
              key={server.name}
              className="flex items-start gap-2 rounded-md border border-border/50 bg-secondary/50 px-3 py-2"
            >
              <BadgeIcon
                className={`mt-0.5 size-3.5 shrink-0 ${badge.className}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">
                    {server.name}
                  </span>
                  <span className={`text-[10px] ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>
                {server.tools && server.tools.length > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground/60">
                    {server.tools.length} tool
                    {server.tools.length !== 1 ? "s" : ""}:{" "}
                    {server.tools
                      .slice(0, 5)
                      .map((t) => t.name)
                      .join(", ")}
                    {server.tools.length > 5
                      ? `, +${server.tools.length - 5} more`
                      : ""}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

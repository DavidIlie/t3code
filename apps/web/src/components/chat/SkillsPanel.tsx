import { memo, useState, useCallback } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PanelRightCloseIcon,
  SearchIcon,
  ServerIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type { McpServerInfo, SlashCommandInfo } from "../../providerSessionStore";

interface SkillsPanelProps {
  commands: ReadonlyArray<SlashCommandInfo>;
  mcpServers: ReadonlyArray<McpServerInfo>;
  onInsertCommand: (commandName: string) => void;
  onClose: () => void;
}

export const SkillsPanel = memo(function SkillsPanel({
  commands,
  mcpServers,
  onInsertCommand,
  onClose,
}: SkillsPanelProps) {
  const [filter, setFilter] = useState("");
  const [collapsedServers, setCollapsedServers] = useState<Record<string, boolean>>({});
  const lowerFilter = filter.toLowerCase();

  const toggleServer = useCallback((name: string) => {
    setCollapsedServers((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const filteredCommands = lowerFilter
    ? commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lowerFilter) ||
          cmd.description.toLowerCase().includes(lowerFilter),
      )
    : commands;

  const filteredServers = lowerFilter
    ? mcpServers.filter(
        (server) =>
          server.name.toLowerCase().includes(lowerFilter) ||
          server.tools?.some(
            (tool) =>
              tool.name.toLowerCase().includes(lowerFilter) ||
              tool.description?.toLowerCase().includes(lowerFilter),
          ),
      )
    : mcpServers;

  const isEmpty = filteredCommands.length === 0 && filteredServers.length === 0;

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <ZapIcon className="size-3" />
            Skills
          </Badge>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close skills panel">
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>

      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter commands & tools..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 pb-4">
          {isEmpty ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {commands.length === 0 && mcpServers.length === 0
                ? "No skills available. Start a session to discover provider commands and MCP tools."
                : "No results matching your filter."}
            </div>
          ) : (
            <>
              {filteredCommands.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Commands
                  </h3>
                  <div className="space-y-0.5">
                    {filteredCommands.map((cmd) => (
                      <button
                        key={cmd.name}
                        type="button"
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent cursor-pointer"
                        onClick={() => onInsertCommand(cmd.name)}
                      >
                        <span className="shrink-0 font-mono text-primary">/{cmd.name}</span>
                        <span className="min-w-0 text-muted-foreground">
                          {cmd.description}
                          {cmd.argumentHint && (
                            <span className="ml-1 text-muted-foreground/60">
                              {cmd.argumentHint}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredServers.length > 0 && (
                <div>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    MCP Servers
                  </h3>
                  <div className="space-y-1">
                    {filteredServers.map((server) => {
                      const isCollapsed = collapsedServers[server.name] ?? false;
                      const filteredTools = lowerFilter
                        ? server.tools?.filter(
                            (tool) =>
                              tool.name.toLowerCase().includes(lowerFilter) ||
                              tool.description?.toLowerCase().includes(lowerFilter),
                          )
                        : server.tools;

                      return (
                        <div key={server.name}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent cursor-pointer"
                            onClick={() => toggleServer(server.name)}
                          >
                            {isCollapsed ? (
                              <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
                            )}
                            <ServerIcon className="size-3 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate font-medium">{server.name}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "ml-auto shrink-0 text-[10px]",
                                server.status === "connected"
                                  ? "text-emerald-600"
                                  : server.status === "error"
                                    ? "text-rose-500"
                                    : "text-muted-foreground",
                              )}
                            >
                              {server.status}
                            </Badge>
                          </button>
                          {!isCollapsed && filteredTools && filteredTools.length > 0 && (
                            <div className="ml-6 space-y-0.5 pb-1">
                              {filteredTools.map((tool) => (
                                <div
                                  key={tool.name}
                                  className="rounded-md px-2 py-1 text-xs text-muted-foreground"
                                >
                                  <span className="font-mono text-foreground/80">{tool.name}</span>
                                  {tool.description && (
                                    <span className="ml-1.5">{tool.description}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

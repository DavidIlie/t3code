import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpenIcon,
  BoxIcon,
  BrainIcon,
  ChevronDownIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  HeartIcon,
  ImageIcon,
  LayersIcon,
  LayoutGridIcon,
  MailIcon,
  MapIcon,
  MusicIcon,
  PackageIcon,
  PaletteIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldIcon,
  ShoppingCartIcon,
  StarIcon,
  TerminalIcon,
  Trash2Icon,
  UserIcon,
  VideoIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { serverHttpOrigin } from "../lib/serverOrigin";
import { readNativeApi } from "../nativeApi";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "./ui/dialog";

// ── Icon Picker ─────────────────────────────────────────────────────

const ICON_OPTIONS: Array<{ name: string; icon: LucideIcon }> = [
  { name: "code", icon: CodeIcon },
  { name: "terminal", icon: TerminalIcon },
  { name: "globe", icon: GlobeIcon },
  { name: "server", icon: ServerIcon },
  { name: "database", icon: DatabaseIcon },
  { name: "cpu", icon: CpuIcon },
  { name: "zap", icon: ZapIcon },
  { name: "rocket", icon: RocketIcon },
  { name: "brain", icon: BrainIcon },
  { name: "shield", icon: ShieldIcon },
  { name: "wrench", icon: WrenchIcon },
  { name: "package", icon: PackageIcon },
  { name: "layers", icon: LayersIcon },
  { name: "layout-grid", icon: LayoutGridIcon },
  { name: "box", icon: BoxIcon },
  { name: "star", icon: StarIcon },
  { name: "heart", icon: HeartIcon },
  { name: "user", icon: UserIcon },
  { name: "mail", icon: MailIcon },
  { name: "image", icon: ImageIcon },
  { name: "video", icon: VideoIcon },
  { name: "music", icon: MusicIcon },
  { name: "book-open", icon: BookOpenIcon },
  { name: "map", icon: MapIcon },
  { name: "palette", icon: PaletteIcon },
  { name: "shopping-cart", icon: ShoppingCartIcon },
  { name: "file", icon: FileIcon },
  { name: "folder", icon: FolderIcon },
];

export function getProjectIconComponent(name: string): LucideIcon | null {
  return ICON_OPTIONS.find((o) => o.name === name)?.icon ?? null;
}

// ── Types ───────────────────────────────────────────────────────────

interface McpServerInfo {
  name: string;
  type: string;
  status: string;
  source: string;
  command?: string;
  args?: string[];
  url?: string;
}

// ── MCP Card ────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  plugin: "bg-purple-500/15 text-purple-400",
  project: "bg-blue-500/15 text-blue-400",
  global: "bg-emerald-500/15 text-emerald-400",
  cursor: "bg-amber-500/15 text-amber-400",
};

function McpServerCard({ server, onRemove }: { server: McpServerInfo; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const canRemove = server.source !== "plugin" && server.source !== "cursor";
  const badgeColor = SOURCE_COLORS[server.source] ?? "bg-secondary text-muted-foreground";

  const detail =
    server.type === "stdio" && server.command
      ? `${server.command}${server.args?.length ? ` ${server.args.join(" ")}` : ""}`
      : (server.url ?? null);

  return (
    <div className="rounded-lg border border-border/50 bg-secondary/30 transition-colors hover:bg-secondary/60">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <ServerIcon className="size-4 shrink-0 text-blue-500" />
        <span className="flex-1 truncate text-xs font-medium text-foreground/90">
          {server.name}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badgeColor}`}>
          {server.source}
        </span>
        <ChevronDownIcon
          className={`size-3 shrink-0 text-muted-foreground/40 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2.5 text-[11px]">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/50">Type:</span>
              <span className="text-foreground/70">{server.type}</span>
            </div>
            {detail && (
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-muted-foreground/50">
                  {server.url ? "URL:" : "Command:"}
                </span>
                <code className="min-w-0 break-all rounded bg-background/50 px-1 py-0.5 font-mono text-[10px] text-foreground/60">
                  {detail}
                </code>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/50">Status:</span>
              <span className="text-foreground/70">{server.status}</span>
            </div>
          </div>
          {canRemove && (
            <button
              type="button"
              className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2Icon className="size-3" />
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── MCP Grouped List ────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  plugin: "Claude Code Plugins",
  project: "Project",
  global: "Global",
  cursor: "Cursor",
};

const SOURCE_ORDER = ["plugin", "cursor", "project", "global"];

function McpServerGroupedList({
  servers,
  search,
  onRemove,
}: {
  servers: McpServerInfo[];
  search: string;
  onRemove: (name: string, source: string) => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return servers;
    const q = search.trim().toLowerCase();
    return servers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.source.toLowerCase().includes(q),
    );
  }, [servers, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, McpServerInfo[]>();
    for (const server of filtered) {
      const list = groups.get(server.source);
      if (list) {
        list.push(server);
      } else {
        groups.set(server.source, [server]);
      }
    }
    return SOURCE_ORDER.filter((key) => groups.has(key)).map((key) => ({
      source: key,
      label: SOURCE_LABELS[key] ?? key,
      servers: groups.get(key)!,
    }));
  }, [filtered]);

  if (filtered.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground/40">
        {search ? "No servers match your search." : "No MCP servers configured."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.source}>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
            {group.label}
          </p>
          <div className="space-y-1.5">
            {group.servers.map((server) => (
              <McpServerCard
                key={server.name}
                server={server}
                onRemove={() => onRemove(server.name, server.source)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Dialog ─────────────────────────────────────────────────────

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectCwd: string;
}

export default function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectCwd,
}: ProjectSettingsDialogProps) {
  const { settings, updateSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const currentIcon = settings.projectIcons[projectId];

  // ── Icon state ──
  const [iconTab, setIconTab] = useState<"favicon" | "lucide" | "emoji" | "file">(
    currentIcon?.type === "lucide"
      ? "lucide"
      : currentIcon?.type === "emoji"
        ? "emoji"
        : currentIcon?.type === "file"
          ? "file"
          : "favicon",
  );
  const [emojiInput, setEmojiInput] = useState(
    currentIcon?.type === "emoji" ? currentIcon.value : "",
  );
  const [selectedLucideIcon, setSelectedLucideIcon] = useState(
    currentIcon?.type === "lucide" ? currentIcon.value : "",
  );
  const [filePathInput, setFilePathInput] = useState(
    currentIcon?.type === "file" ? currentIcon.value : "",
  );

  const saveIcon = useCallback(() => {
    const nextIcons = { ...settings.projectIcons };
    if (iconTab === "favicon") {
      delete nextIcons[projectId];
    } else if (iconTab === "lucide" && selectedLucideIcon) {
      nextIcons[projectId] = { type: "lucide", value: selectedLucideIcon };
    } else if (iconTab === "emoji" && emojiInput.trim()) {
      nextIcons[projectId] = { type: "emoji", value: emojiInput.trim() };
    } else if (iconTab === "file" && filePathInput.trim()) {
      nextIcons[projectId] = { type: "file", value: filePathInput.trim() };
    }
    updateSettings({ projectIcons: nextIcons });
  }, [
    iconTab,
    selectedLucideIcon,
    emojiInput,
    filePathInput,
    projectId,
    settings.projectIcons,
    updateSettings,
  ]);

  // ── MCP state ──
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [mcpLoaded, setMcpLoaded] = useState(false);
  const [mcpSearch, setMcpSearch] = useState("");
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState<"stdio" | "sse" | "http">("stdio");
  const [addCommand, setAddCommand] = useState("");
  const [addArgs, setAddArgs] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addScope, setAddScope] = useState<"global" | "project">("global");
  const [isAdding, setIsAdding] = useState(false);

  const loadMcpServers = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    try {
      const result = await api.projects.getMcpServers({ workspaceRoot: projectCwd });
      setMcpServers(result.servers as McpServerInfo[]);
      setMcpLoaded(true);
    } catch {
      setMcpLoaded(true);
    }
  }, [projectCwd]);

  // Load MCP servers when dialog opens
  useEffect(() => {
    if (open && !mcpLoaded) {
      void loadMcpServers();
    }
  }, [open, mcpLoaded, loadMcpServers]);

  const handleAddMcp = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !addName.trim()) return;
    setIsAdding(true);
    try {
      await api.projects.addMcpServer({
        workspaceRoot: projectCwd,
        scope: addScope,
        name: addName.trim(),
        type: addType,
        ...(addType === "stdio"
          ? { command: addCommand.trim(), args: addArgs.trim() ? addArgs.split(/\s+/) : undefined }
          : { url: addUrl.trim() }),
      });
      setAddName("");
      setAddCommand("");
      setAddArgs("");
      setAddUrl("");
      setShowAddMcp(false);
      void loadMcpServers();
      void queryClient.invalidateQueries({ queryKey: ["projectMcpServers", projectCwd] });
    } catch {
      // best effort
    } finally {
      setIsAdding(false);
    }
  }, [
    addName,
    addType,
    addCommand,
    addArgs,
    addUrl,
    addScope,
    projectCwd,
    loadMcpServers,
    queryClient,
  ]);

  const handleRemoveMcp = useCallback(
    async (name: string, source: string) => {
      const api = readNativeApi();
      if (!api) return;
      try {
        await api.projects.removeMcpServer({
          workspaceRoot: projectCwd,
          scope: source === "global" ? "global" : "project",
          name,
        });
        void loadMcpServers();
        void queryClient.invalidateQueries({ queryKey: ["projectMcpServers", projectCwd] });
      } catch {
        // best effort
      }
    },
    [projectCwd, loadMcpServers, queryClient],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{projectName}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{projectCwd}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-6">
            {/* Icon section */}
            <section>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                Project Icon
              </h3>
              <div className="flex gap-2 mb-3">
                {(["favicon", "lucide", "emoji", "file"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                      iconTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:bg-accent"
                    }`}
                    onClick={() => setIconTab(tab)}
                  >
                    {tab === "favicon"
                      ? "Auto (Favicon)"
                      : tab === "lucide"
                        ? "Icon"
                        : tab === "emoji"
                          ? "Emoji"
                          : "Image"}
                  </button>
                ))}
              </div>

              {iconTab === "lucide" && (
                <div className="grid grid-cols-7 gap-1.5">
                  {ICON_OPTIONS.map((opt) => {
                    const isSelected = selectedLucideIcon === opt.name;
                    return (
                      <button
                        key={opt.name}
                        type="button"
                        className={`flex size-9 items-center justify-center rounded-lg border transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 bg-secondary/50 text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                        onClick={() => {
                          setSelectedLucideIcon(opt.name);
                          const nextIcons = { ...settings.projectIcons };
                          nextIcons[projectId] = { type: "lucide", value: opt.name };
                          updateSettings({ projectIcons: nextIcons });
                        }}
                        title={opt.name}
                      >
                        <opt.icon className="size-4" />
                      </button>
                    );
                  })}
                </div>
              )}

              {iconTab === "emoji" && (
                <div className="flex items-center gap-2">
                  <input
                    className="w-20 rounded-md border border-border bg-background px-2.5 py-1.5 text-center text-lg focus:border-ring focus:outline-none"
                    placeholder="🚀"
                    value={emojiInput}
                    onChange={(e) => setEmojiInput(e.target.value)}
                    maxLength={4}
                  />
                  <button
                    type="button"
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    disabled={!emojiInput.trim()}
                    onClick={saveIcon}
                  >
                    Save
                  </button>
                </div>
              )}

              {iconTab === "file" && (
                <div className="space-y-2">
                  {isElectron && (
                    <button
                      type="button"
                      className="w-full rounded-md border border-dashed border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={async () => {
                        const api = readNativeApi();
                        if (!api) return;
                        const picked = await api.dialogs.pickFile();
                        if (picked) {
                          setFilePathInput(picked);
                          const nextIcons = { ...settings.projectIcons };
                          nextIcons[projectId] = { type: "file", value: picked };
                          updateSettings({ projectIcons: nextIcons });
                        }
                      }}
                    >
                      Browse for image...
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                      placeholder="/path/to/icon.png"
                      value={filePathInput}
                      onChange={(e) => setFilePathInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                      disabled={!filePathInput.trim()}
                      onClick={saveIcon}
                    >
                      Save
                    </button>
                  </div>
                  {filePathInput.trim() && (
                    <div className="flex items-center gap-2">
                      <img
                        src={`${serverHttpOrigin}/api/project-icon?path=${encodeURIComponent(filePathInput)}`}
                        alt="Preview"
                        className="size-8 rounded-md object-contain bg-secondary/50"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground/50">Preview</span>
                    </div>
                  )}
                </div>
              )}

              {iconTab === "favicon" && currentIcon && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    const nextIcons = { ...settings.projectIcons };
                    delete nextIcons[projectId];
                    updateSettings({ projectIcons: nextIcons });
                  }}
                >
                  Reset to auto-detected favicon
                </button>
              )}
            </section>

            {/* MCP section */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
                  MCP Servers
                  {mcpLoaded && (
                    <span className="ml-1.5 text-muted-foreground/30">{mcpServers.length}</span>
                  )}
                </h3>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setShowAddMcp(!showAddMcp)}
                >
                  {showAddMcp ? <XIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
                  <span>{showAddMcp ? "Cancel" : "Add"}</span>
                </button>
              </div>

              {showAddMcp && (
                <div className="mb-3 space-y-2 rounded-lg border border-border bg-secondary/50 p-3">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                      placeholder="Server name"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                    />
                    <select
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
                      value={addScope}
                      onChange={(e) => setAddScope(e.target.value as "global" | "project")}
                    >
                      <option value="global">Global</option>
                      <option value="project">Project</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    {(["stdio", "sse", "http"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                          addType === t
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-accent"
                        }`}
                        onClick={() => setAddType(t)}
                      >
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {addType === "stdio" ? (
                    <div className="space-y-2">
                      <input
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                        placeholder="Command (e.g. npx)"
                        value={addCommand}
                        onChange={(e) => setAddCommand(e.target.value)}
                      />
                      <input
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                        placeholder="Arguments (space-separated)"
                        value={addArgs}
                        onChange={(e) => setAddArgs(e.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                      placeholder="URL (e.g. http://localhost:3003/sse)"
                      value={addUrl}
                      onChange={(e) => setAddUrl(e.target.value)}
                    />
                  )}
                  <button
                    type="button"
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    disabled={!addName.trim() || isAdding}
                    onClick={() => void handleAddMcp()}
                  >
                    {isAdding ? "Adding..." : "Add server"}
                  </button>
                </div>
              )}

              {/* Search bar — only show when there are enough servers */}
              {mcpLoaded && mcpServers.length > 5 && (
                <div className="relative mb-3">
                  <SearchIcon className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
                  <input
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                    placeholder="Search servers..."
                    value={mcpSearch}
                    onChange={(e) => setMcpSearch(e.target.value)}
                  />
                </div>
              )}

              {mcpLoaded ? (
                <McpServerGroupedList
                  servers={mcpServers}
                  search={mcpSearch}
                  onRemove={(name, source) => void handleRemoveMcp(name, source)}
                />
              ) : (
                <p className="text-xs text-muted-foreground/40">Loading...</p>
              )}
            </section>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

import type { ClientOrchestrationCommand, UploadChatAttachment } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HomeIcon,
  ListTreeIcon,
  MessageSquarePlusIcon,
  MinimizeIcon,
  PencilLineIcon,
  SettingsIcon,
} from "lucide-react";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { isMacPlatform, newCommandId, newMessageId, newThreadId } from "../lib/utils";
import { useStore } from "../store";
import { readNativeApi } from "../nativeApi";

// ── Types ─────────────────────────────────────────────────────────────

interface CommandBarItem {
  id: string;
  label: string;
  description?: string;
  icon: ReactNode;
  group: string;
  keywords?: string[];
  action: () => void;
}

interface CommandBarGroup {
  label: string;
  items: { item: CommandBarItem; flatIndex: number }[];
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useCommandBar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Don't intercept Cmd+K when terminal is focused (used for terminal clear)
      if (isTerminalFocused()) return;
      const isMod = isMacPlatform(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (isMod && e.key === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}

// ── Component ─────────────────────────────────────────────────────────

export function CommandBar(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props;
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId as string | undefined) ?? null,
  });

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setHighlightedIndex(0);
  }, [onOpenChange]);

  // Build commands — skip when closed to avoid wasted work
  const items = useMemo<CommandBarItem[]>(() => {
    if (!open) return [];

    const api = readNativeApi();
    const cmds: CommandBarItem[] = [];

    // ── Navigation ────────────────────────────────────────
    cmds.push({
      id: "nav:home",
      label: "Go Home",
      description: "Navigate to the home screen",
      icon: <HomeIcon className="size-4" />,
      group: "Navigation",
      keywords: ["home", "landing", "start"],
      action: () => {
        void navigate({ to: "/" });
        close();
      },
    });

    cmds.push({
      id: "nav:settings",
      label: "Open Settings",
      description: "Configure app settings",
      icon: <SettingsIcon className="size-4" />,
      group: "Navigation",
      keywords: ["settings", "preferences", "config"],
      action: () => {
        void navigate({ to: "/settings" });
        close();
      },
    });

    // ── Projects ──────────────────────────────────────────
    for (const project of projects) {
      cmds.push({
        id: `project:${project.id}`,
        label: project.name,
        description: project.cwd,
        icon: <FolderOpenIcon className="size-4" />,
        group: "Projects",
        keywords: ["project", "open", project.name.toLowerCase(), project.cwd.toLowerCase()],
        action: () => {
          void navigate({ to: "/project/$projectId", params: { projectId: project.id } });
          close();
        },
      });
    }

    if (isElectron) {
      cmds.push({
        id: "project:add-desktop",
        label: "Add Project (Folder Picker)",
        description: "Open a folder using the native file picker",
        icon: <FolderPlusIcon className="size-4" />,
        group: "Projects",
        keywords: ["add", "new", "folder", "open", "project"],
        action: () => {
          void window.desktopBridge?.pickFolder?.();
          close();
        },
      });
    }

    // ── Actions ───────────────────────────────────────────
    const activeProject = routeThreadId
      ? projects.find((p) =>
          threads.some((t) => t.id === routeThreadId && t.projectId === p.id),
        )
      : projects[0];

    if (activeProject) {
      cmds.push({
        id: "action:new-chat",
        label: "New Chat",
        description: `In ${activeProject.name}`,
        icon: <MessageSquarePlusIcon className="size-4" />,
        group: "Actions",
        keywords: ["new", "chat", "thread", "conversation"],
        action: () => {
          const {
            clearProjectDraftThreadId,
            setProjectDraftThreadId,
          } = useComposerDraftStore.getState();
          clearProjectDraftThreadId(activeProject.id);
          const threadId = newThreadId();
          const createdAt = new Date().toISOString();
          setProjectDraftThreadId(activeProject.id, threadId, {
            createdAt,
            branch: null,
            worktreePath: null,
            envMode: "local",
            runtimeMode: "full-access",
          });
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
          close();
        },
      });

      cmds.push({
        id: "action:plan-mode",
        label: "New Chat (Plan Mode)",
        description: `Plan in ${activeProject.name}`,
        icon: <PencilLineIcon className="size-4" />,
        group: "Actions",
        keywords: ["plan", "mode", "architect", "design"],
        action: () => {
          const {
            clearProjectDraftThreadId,
            setProjectDraftThreadId,
          } = useComposerDraftStore.getState();
          clearProjectDraftThreadId(activeProject.id);
          const threadId = newThreadId();
          const createdAt = new Date().toISOString();
          setProjectDraftThreadId(activeProject.id, threadId, {
            createdAt,
            branch: null,
            worktreePath: null,
            envMode: "local",
            runtimeMode: "full-access",
            interactionMode: "plan",
          });
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
          close();
        },
      });
    }

    // Compact conversation (send /compact as a message to active thread)
    if (routeThreadId && api) {
      const activeThread = threads.find((t) => t.id === routeThreadId);
      if (activeThread?.session?.status === "ready" || activeThread?.session?.status === "running") {
        cmds.push({
          id: "action:compact",
          label: "Compact Conversation",
          description: "Send /compact to reduce context usage",
          icon: <MinimizeIcon className="size-4" />,
          group: "Actions",
          keywords: ["compact", "compress", "truncate", "context", "memory"],
          action: () => {
            const cmd: ClientOrchestrationCommand = {
              type: "thread.turn.start",
              commandId: newCommandId(),
              threadId: activeThread.id,
              message: {
                messageId: newMessageId(),
                role: "user",
                text: "/compact",
                attachments: [] as UploadChatAttachment[],
              },
              runtimeMode: activeThread.runtimeMode,
              interactionMode: activeThread.interactionMode,
              createdAt: new Date().toISOString(),
            };
            void api.orchestration.dispatchCommand(cmd);
            close();
          },
        });
      }
    }

    // ── Recent Threads ────────────────────────────────────
    const recentThreads = threads
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    for (const thread of recentThreads) {
      const project = projects.find((p) => p.id === thread.projectId);
      cmds.push({
        id: `thread:${thread.id}`,
        label: thread.title || "Untitled thread",
        description: project?.name ?? "",
        icon: <ArrowRightIcon className="size-4" />,
        group: "Recent Conversations",
        keywords: [
          "thread",
          "conversation",
          "chat",
          thread.title?.toLowerCase() ?? "",
          project?.name?.toLowerCase() ?? "",
        ],
        action: () => {
          void navigate({ to: "/$threadId", params: { threadId: thread.id } });
          close();
        },
      });
    }

    return cmds;
  }, [open, close, navigate, projects, routeThreadId, threads]);

  // Filter items and compute groups with pre-assigned flat indices + flat lookup array
  const { grouped, flatItems } = useMemo(() => {
    let source = items;
    if (query.trim()) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      source = items.filter((item) => {
        const haystack = [
          item.label.toLowerCase(),
          item.description?.toLowerCase() ?? "",
          ...(item.keywords ?? []),
        ].join(" ");
        return terms.every((term) => haystack.includes(term));
      });
    }

    const groupMap = new Map<string, CommandBarGroup>();
    const groupOrder: CommandBarGroup[] = [];
    const flat: CommandBarItem[] = [];
    let idx = 0;
    for (const item of source) {
      let group = groupMap.get(item.group);
      if (!group) {
        group = { label: item.group, items: [] };
        groupMap.set(item.group, group);
        groupOrder.push(group);
      }
      group.items.push({ item, flatIndex: idx });
      flat.push(item);
      idx++;
    }
    return { grouped: groupOrder, flatItems: flat };
  }, [items, query]);

  // Clamp highlighted index when filtered results shrink — derive inline
  const clampedHighlight = highlightedIndex >= flatItems.length
    ? Math.max(0, flatItems.length - 1)
    : highlightedIndex;

  // Sync clamped value back to state only when it drifts
  useEffect(() => {
    if (clampedHighlight !== highlightedIndex) {
      setHighlightedIndex(clampedHighlight);
    }
  }, [clampedHighlight, highlightedIndex]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${clampedHighlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, clampedHighlight]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        flatItems[clampedHighlight]?.action();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    },
    [close, flatItems, clampedHighlight],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]" onClick={close}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/32 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="flex h-full items-start justify-center pt-[max(1rem,10vh)]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="relative w-full max-w-xl overflow-hidden rounded-2xl border bg-popover shadow-lg"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <ListTreeIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightedIndex(0);
              }}
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {grouped.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>
            )}
            {grouped.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map(({ item, flatIndex }) => {
                  const isHighlighted = flatIndex === clampedHighlight;
                  return (
                    <button
                      key={item.id}
                      data-index={flatIndex}
                      type="button"
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isHighlighted
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/50"
                      }`}
                      onMouseEnter={() => setHighlightedIndex(flatIndex)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => item.action()}
                    >
                      <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.description && (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
                  &uarr;
                </kbd>
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
                  &darr;
                </kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
                  &crarr;
                </kbd>
                select
              </span>
            </div>
            <span>
              {flatItems.length} result{flatItems.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

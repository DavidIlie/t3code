import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  GitPullRequestIcon,
  HomeIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  ProjectId,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import { APP_STAGE_LABEL } from "../branding";
import { isMacPlatform, newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { useStore } from "../store";
import { isChatNewLocalShortcut, isChatNewShortcut, shortcutLabelForCommand } from "../keybindings";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { gitPushWithToast } from "../lib/gitPushWithToast";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { readNativeApi } from "../nativeApi";
import { type DraftThreadEnvMode, useComposerDraftStore } from "../composerDraftStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "./ui/dialog";
import ProjectSettingsDialog, { getProjectIconComponent } from "./ProjectSettingsDialog";
import AccountPill from "./AccountPill";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
  shouldOpenProjectFolderPickerImmediately,
} from "./Sidebar.logic";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
} from "./ui/sidebar";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard API unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

function terminalStatusFromRunningIds(
  runningTerminalIds: string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0 text-foreground"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Derives the server's HTTP origin (scheme + host + port) from the same
 * sources WsTransport uses, converting ws(s) to http(s).
 */
function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
  // Parse to extract just the origin, dropping path/query (e.g. ?token=…)
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

const serverHttpOrigin = getServerHttpOrigin();

function ProjectFavicon({
  cwd,
  projectId,
  size = "sm",
}: {
  cwd: string;
  projectId?: string;
  size?: "sm" | "md";
}) {
  const { settings } = useAppSettings();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const sizeClass = size === "md" ? "size-5" : "size-3.5";

  // Check for custom icon
  const customIcon = projectId ? settings.projectIcons[projectId] : undefined;

  if (customIcon?.type === "lucide") {
    const LucideIcon = getProjectIconComponent(customIcon.value);
    if (LucideIcon) {
      return <LucideIcon className={`${sizeClass} shrink-0 text-primary`} />;
    }
  }

  if (customIcon?.type === "emoji") {
    return (
      <span className={`${size === "md" ? "text-base" : "text-sm"} shrink-0 leading-none`}>
        {customIcon.value}
      </span>
    );
  }

  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`;

  if (status === "error") {
    return <FolderIcon className={`${sizeClass} shrink-0 text-muted-foreground/50`} />;
  }

  return (
    <img
      src={src}
      alt=""
      className={`${sizeClass} shrink-0 rounded-sm object-contain ${status === "loading" ? "hidden" : ""}`}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")}
    />
  );
}

type SortableProjectHandleProps = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

function SortableProjectItem({
  projectId,
  children,
}: {
  projectId: ProjectId;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: projectId });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners })}
    </li>
  );
}

export default function Sidebar() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const toggleProject = useStore((store) => store.toggleProject);
  const reorderProjects = useStore((store) => store.reorderProjects);
  const setProjectExpanded = useStore((store) => store.setProjectExpanded);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearThreadDraft);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const navigate = useNavigate();
  const isOnSettings = useLocation({ select: (loc) => loc.pathname === "/settings" });
  const isOnHome = useLocation({ select: (loc) => loc.pathname === "/" });
  const { settings: appSettings, updateSettings } = useAppSettings();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeProjectId = useParams({
    strict: false,
    select: (params) => ("projectId" in params ? (params.projectId as string) : null),
  });
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);
  const [settingsDialogProjectId, setSettingsDialogProjectId] = useState<ProjectId | null>(null);
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const selectedThreadIds = useThreadSelectionStore((s) => s.selectedThreadIds);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const shouldBrowseForProjectImmediately = shouldOpenProjectFolderPickerImmediately({
    isElectron,
    isMobile,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const preSearchExpandedRef = useRef<Map<string, boolean> | null>(null);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedSearchQuery.length > 0;

  useEffect(() => {
    if (isSearching) {
      if (!preSearchExpandedRef.current) {
        preSearchExpandedRef.current = new Map(projects.map((p) => [p.id, p.expanded]));
      }
      // Auto-expand all projects during search
      for (const project of projects) {
        if (!project.expanded) {
          setProjectExpanded(project.id, true);
        }
      }
    } else if (preSearchExpandedRef.current) {
      // Restore expansion state
      for (const project of projects) {
        const wasExpanded = preSearchExpandedRef.current.get(project.id) ?? false;
        if (project.expanded !== wasExpanded) {
          setProjectExpanded(project.id, wasExpanded);
        }
      }
      preSearchExpandedRef.current = null;
    }
  }, [isSearching, projects, setProjectExpanded]);

  const pendingApprovalByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingApprovals(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const pendingUserInputByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingUserInputs(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      if (storedDraftThread) {
        return (async () => {
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        })();
      }
      clearProjectDraftThreadId(projectId);

      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (activeDraftThread && routeThreadId && activeDraftThread.projectId === projectId) {
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(routeThreadId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve();
      }
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [
      clearProjectDraftThreadId,
      getDraftThreadByProjectId,
      navigate,
      getDraftThread,
      routeThreadId,
      setDraftThreadContext,
      setProjectDraftThreadId,
    ],
  );

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = threads
        .filter((thread) => thread.projectId === projectId)
        .toSorted((a, b) => {
          const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (byDate !== 0) return byDate;
          return b.id.localeCompare(a.id);
        })[0];
      if (!latestThread) return;

      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [navigate, threads],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setAddProjectError(null);
        setShowAddProjectDialog(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        });
        await handleNewThread(projectId).catch(() => undefined);

        // Import Claude Code session history
        try {
          const result = await api.projects.importHistory({ workspaceRoot: cwd });
          let importedCount = 0;
          for (const session of result.sessions) {
            try {
              await api.orchestration.dispatchCommand({
                type: "thread.create",
                commandId: newCommandId(),
                threadId: ThreadId.makeUnsafe(`claude-${session.sessionId}`),
                projectId,
                title: session.summary || "Imported session",
                model: DEFAULT_MODEL_BY_PROVIDER.codex,
                runtimeMode: DEFAULT_RUNTIME_MODE,
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                createdAt: new Date(session.lastModified).toISOString(),
              });
              importedCount++;
            } catch {
              // Ignore duplicate errors from requireThreadAbsent
            }
          }
          if (importedCount > 0) {
            toastManager.add({
              type: "info",
              title: `Imported ${importedCount} sessions from Claude Code`,
            });
          }
        } catch {
          // Silently ignore import failures — not critical
        }
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "An error occurred while adding the project.";
        setIsAddingProject(false);
        if (shouldBrowseForProjectImmediately) {
          toastManager.add({
            type: "error",
            title: "Failed to add project",
            description,
          });
        } else {
          setAddProjectError(description);
        }
        return;
      }
      finishAddingProject();
    },
    [
      focusMostRecentThreadForProject,
      handleNewThread,
      isAddingProject,
      projects,
      shouldBrowseForProjectImmediately,
    ],
  );

  const handleAddProject = () => {
    void addProjectFromPath(newCwd);
  };

  const canAddProject = newCwd.trim().length > 0 && !isAddingProject;

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    } else if (!shouldBrowseForProjectImmediately) {
      addProjectInputRef.current?.focus();
    }
    setIsPickingFolder(false);
  };

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  /**
   * Delete a single thread: stop session, close terminal, dispatch delete,
   * clean up drafts/state, and optionally remove orphaned worktree.
   * Callers handle thread-level confirmation; this still prompts for worktree removal.
   */
  const deleteThread = useCallback(
    async (
      threadId: ThreadId,
      opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {},
    ): Promise<void> => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;

      const threadProject = projects.find((project) => project.id === thread.projectId);
      // When bulk-deleting, exclude the other threads being deleted so
      // getOrphanedWorktreePathForThread correctly detects that no surviving
      // threads will reference this worktree.
      const deletedIds = opts.deletedThreadIds;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? threads.filter((t) => t.id === threadId || !deletedIds.has(t.id))
          : threads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({ threadId, deleteHistory: true });
      } catch {
        // Terminal may already be closed
      }

      const allDeletedIds = deletedIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId =
        threads.find((entry) => entry.id !== threadId && !allDeletedIds.has(entry.id))?.id ?? null;
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);
      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      navigate,
      projects,
      removeWorktreeMutation,
      routeThreadId,
      threads,
    ],
  );

  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename thread" },
          { id: "mark-unread", label: "Mark unread" },
          { id: "copy-thread-id", label: "Copy Thread ID" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadId);
        return;
      }
      if (clicked === "copy-thread-id") {
        try {
          await copyTextToClipboard(threadId);
          toastManager.add({
            type: "success",
            title: "Thread ID copied",
            description: threadId,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy thread ID",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked !== "delete") return;
      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      await deleteThread(threadId);
    },
    [appSettings.confirmThreadDelete, deleteThread, markThreadUnread, threads],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const ids = [...selectedThreadIds];
      if (ids.length === 0) return;
      const count = ids.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const id of ids) {
          markThreadUnread(id);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedIds = new Set<ThreadId>(ids);
      for (const id of ids) {
        await deleteThread(id, { deletedThreadIds: deletedIds });
      }
      removeFromSelection(ids);
    },
    [
      appSettings.confirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      selectedThreadIds,
    ],
  );

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadId);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadId, orderedProjectThreadIds);
        return;
      }

      // Plain click — clear selection, set anchor for future shift-clicks, and navigate
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadId);
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      clearSelection,
      navigate,
      rangeSelectTo,
      selectedThreadIds.size,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  // Sync Claude Code sessions: on boot, on window re-focus after 5min, and via manual trigger
  const lastSyncRef = useRef(0);
  const syncClaudeCodeSessions = useCallback(
    async (targetProjects?: typeof projects) => {
      const api = readNativeApi();
      if (!api) return;
      const projectsToSync = targetProjects ?? projects;
      let totalImported = 0;
      for (const project of projectsToSync) {
        try {
          const result = await api.projects.importHistory({ workspaceRoot: project.cwd });
          for (const session of result.sessions) {
            const threadId = ThreadId.makeUnsafe(`claude-${session.sessionId}`);
            if (threads.some((t) => t.id === threadId)) continue;
            try {
              await api.orchestration.dispatchCommand({
                type: "thread.create",
                commandId: newCommandId(),
                threadId,
                projectId: project.id,
                title: session.summary || "Imported session",
                model: DEFAULT_MODEL_BY_PROVIDER.codex,
                runtimeMode: DEFAULT_RUNTIME_MODE,
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                createdAt: new Date(session.lastModified).toISOString(),
              });
              totalImported++;
            } catch {
              // Ignore duplicate errors
            }
          }
        } catch {
          // Silently ignore
        }
      }
      lastSyncRef.current = Date.now();
      return totalImported;
    },
    [projects, threads],
  );

  // Keep a stable ref so the boot timer and focus handler don't re-fire
  // every time `threads` or `projects` change (which would re-create
  // syncClaudeCodeSessions and reset the timer during thread creation).
  const syncRef = useRef(syncClaudeCodeSessions);
  syncRef.current = syncClaudeCodeSessions;

  useEffect(() => {
    // Sync on boot after a short delay
    const timer = setTimeout(() => void syncRef.current(), 3_000);

    // Sync on window re-focus if >5 minutes since last sync
    const REFOCUS_DEBOUNCE_MS = 5 * 60_000;
    const handleFocus = () => {
      if (Date.now() - lastSyncRef.current > REFOCUS_DEBOUNCE_MS) {
        void syncRef.current();
      }
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const isPinned = appSettings.pinnedProjectIds.includes(projectId);
      const pinIdx = appSettings.pinnedProjectIds.indexOf(projectId);
      const pinMenuItems = [
        { id: "pin", label: isPinned ? "Unpin project" : "Pin project" },
        ...(isPinned && pinIdx > 0 ? [{ id: "pin-up", label: "Move up" }] : []),
        ...(isPinned && pinIdx < appSettings.pinnedProjectIds.length - 1
          ? [{ id: "pin-down", label: "Move down" }]
          : []),
      ];
      const clicked = await api.contextMenu.show(
        [
          ...pinMenuItems,
          { id: "settings", label: "Project settings" },
          { id: "sync-cc", label: "Sync from Claude Code" },
          { id: "push", label: "Push all current changes" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "pin") {
        if (isPinned) {
          updateSettings({
            pinnedProjectIds: appSettings.pinnedProjectIds.filter((id) => id !== projectId),
          });
        } else {
          updateSettings({
            pinnedProjectIds: [...appSettings.pinnedProjectIds, projectId],
          });
        }
        return;
      }

      if (clicked === "pin-up" || clicked === "pin-down") {
        const ids = [...appSettings.pinnedProjectIds];
        const swapIdx = clicked === "pin-up" ? pinIdx - 1 : pinIdx + 1;
        const a = ids[pinIdx]!;
        const b = ids[swapIdx]!;
        ids[pinIdx] = b;
        ids[swapIdx] = a;
        updateSettings({ pinnedProjectIds: ids });
        return;
      }

      if (clicked === "settings") {
        setSettingsDialogProjectId(projectId);
        return;
      }

      if (clicked === "sync-cc") {
        void syncClaudeCodeSessions([project]).then((count) => {
          if (count && count > 0) {
            toastManager.add({
              type: "info",
              title: `Imported ${count} new sessions from Claude Code`,
            });
          } else {
            toastManager.add({
              type: "info",
              title: "No new Claude Code sessions found",
            });
          }
        });
        return;
      }

      if (clicked === "push") {
        void gitPushWithToast({
          cwd: project.cwd,
          action: "commit_push",
          queryClient,
        }).catch(() => {
          // Error already shown via toast
        });
        return;
      }

      if (clicked !== "delete") return;

      const projectThreads = threads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before deleting it.",
        });
        return;
      }

      const confirmed = await api.dialogs.confirm(
        [`Delete project "${project.name}"?`, "This action cannot be undone."].join("\n"),
      );
      if (!confirmed) return;

      try {
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error deleting project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to delete "${project.name}"`,
          description: message,
        });
      }
    },
    [
      appSettings.pinnedProjectIds,
      clearComposerDraftForThread,
      clearProjectDraftThreadId,
      getDraftThreadByProjectId,
      navigate,
      projects,
      queryClient,
      syncClaudeCodeSessions,
      threads,
      updateSettings,
    ],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = projects.find((project) => project.id === active.id);
      const overProject = projects.find((project) => project.id === over.id);
      if (!activeProject || !overProject) return;
      reorderProjects(activeProject.id, overProject.id);
    },
    [projects, reorderProjects],
  );

  const handleProjectDragStart = useCallback((_event: DragStartEvent) => {
    dragInProgressRef.current = true;
    suppressProjectClickAfterDragRef.current = true;
  }, []);

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const handleProjectTitlePointerDownCapture = useCallback(() => {
    suppressProjectClickAfterDragRef.current = false;
  }, []);

  const handleProjectTitleClick = useCallback((event: React.MouseEvent, projectId: ProjectId) => {
    if (dragInProgressRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (suppressProjectClickAfterDragRef.current) {
      // Consume the synthetic click emitted after a drag release.
      suppressProjectClickAfterDragRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }, []);

  const handleChevronClick = useCallback(
    (event: React.MouseEvent, projectId: ProjectId) => {
      if (dragInProgressRef.current || suppressProjectClickAfterDragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        suppressProjectClickAfterDragRef.current = false;
        return;
      }
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      toggleProject(projectId);
    },
    [clearSelection, selectedThreadIds.size, toggleProject],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedThreadIds.size > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const activeThread = routeThreadId
        ? threads.find((thread) => thread.id === routeThreadId)
        : undefined;
      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (isChatNewLocalShortcut(event, keybindings)) {
        const projectId =
          activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
        if (!projectId) return;
        event.preventDefault();
        void handleNewThread(projectId);
        return;
      }

      if (!isChatNewShortcut(event, keybindings)) return;
      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;
      event.preventDefault();
      void handleNewThread(projectId, {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
      });
    };

    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadIds.size === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [
    clearSelection,
    getDraftThread,
    handleNewThread,
    keybindings,
    projects,
    routeThreadId,
    selectedThreadIds.size,
    threads,
  ]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "chat.newLocal") ??
      shortcutLabelForCommand(keybindings, "chat.new"),
    [keybindings],
  );

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <div className="flex min-w-0 flex-1 items-center gap-1 mt-1.5 ml-1">
        <T3Wordmark />
        <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          Code
        </span>
        <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
          {APP_STAGE_LABEL}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]">
            {wordmark}
            {showDesktopUpdateButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`inline-flex size-7 ml-auto mt-1.5 items-center justify-center rounded-md text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{desktopUpdateTooltip}</TooltipPopup>
              </Tooltip>
            )}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        <div className="px-3 pt-2 pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="sm"
                isActive={isOnHome}
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => void navigate({ to: "/" })}
              >
                <HomeIcon className="size-3.5" />
                <span className="text-xs">Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
        <div className="px-3 pt-2 pb-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              className="w-full rounded-md border border-border bg-secondary py-1.5 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              placeholder="Search projects & threads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        </div>
        {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
          <SidebarGroup className="px-2 pt-2 pb-0">
            <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
              <TriangleAlertIcon />
              <AlertTitle>Intel build on Apple Silicon</AlertTitle>
              <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
              {desktopUpdateButtonAction !== "none" ? (
                <AlertAction>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={desktopUpdateButtonDisabled}
                    onClick={handleDesktopUpdateButtonClick}
                  >
                    {desktopUpdateButtonAction === "download"
                      ? "Download ARM build"
                      : "Install ARM build"}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          </SidebarGroup>
        ) : null}
        {/* Pinned projects icon row */}
        {appSettings.pinnedProjectIds.length > 0 &&
          !isSearching &&
          (() => {
            const pinnedProjects = appSettings.pinnedProjectIds
              .map((id) => projects.find((p) => p.id === id))
              .filter((p): p is NonNullable<typeof p> => p != null && p.name !== "Home");
            if (pinnedProjects.length === 0) return null;
            // 1-2: side by side row with icon+name; 3: stacked rows with icon+name; 4+: icon-only tiles
            const count = pinnedProjects.length;
            const layout = count <= 2 ? "row" : count === 3 ? "stack" : "icons";

            const renderNamedPin = (
              project: (typeof pinnedProjects)[number],
              isActive: boolean,
            ) => (
              <button
                key={project.id}
                type="button"
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                  isActive
                    ? "border-primary/40 bg-primary/10"
                    : "border-border/50 bg-secondary/50 hover:bg-accent"
                }`}
                onClick={() =>
                  void navigate({
                    to: "/project/$projectId",
                    params: { projectId: project.id },
                  })
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleProjectContextMenu(project.id, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                <ProjectFavicon cwd={project.cwd} projectId={project.id} size="md" />
                <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                  {project.name}
                </span>
              </button>
            );

            const renderIconPin = (project: (typeof pinnedProjects)[number], isActive: boolean) => (
              <Tooltip key={project.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={project.name}
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                        isActive
                          ? "border-primary/40 bg-primary/10"
                          : "border-border/50 bg-secondary/50 hover:bg-accent"
                      }`}
                      onClick={() =>
                        void navigate({
                          to: "/project/$projectId",
                          params: { projectId: project.id },
                        })
                      }
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void handleProjectContextMenu(project.id, {
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    />
                  }
                >
                  <ProjectFavicon cwd={project.cwd} projectId={project.id} size="md" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">{project.name}</TooltipPopup>
              </Tooltip>
            );

            return (
              <div className="px-3 pt-2 pb-0">
                {layout === "row" ? (
                  <div className="flex gap-1.5">
                    {pinnedProjects.map((project) =>
                      renderNamedPin(project, routeProjectId === project.id),
                    )}
                  </div>
                ) : layout === "stack" ? (
                  <div className="flex flex-col gap-1">
                    {pinnedProjects.map((project) =>
                      renderNamedPin(project, routeProjectId === project.id),
                    )}
                  </div>
                ) : (
                  <div className="flex gap-1.5 overflow-x-auto">
                    {pinnedProjects.map((project) =>
                      renderIconPin(project, routeProjectId === project.id),
                    )}
                  </div>
                )}
              </div>
            );
          })()}

        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add project"
                    className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      setAddProjectError(null);
                      if (shouldBrowseForProjectImmediately) {
                        void handlePickFolder();
                        return;
                      }
                      setShowAddProjectDialog(true);
                    }}
                  />
                }
              >
                <PlusIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="right">Add project</TooltipPopup>
            </Tooltip>
          </div>

          <DndContext
            sensors={projectDnDSensors}
            collisionDetection={projectCollisionDetection}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragStart={handleProjectDragStart}
            onDragEnd={handleProjectDragEnd}
            onDragCancel={handleProjectDragCancel}
          >
            <SidebarMenu>
              <SortableContext
                items={projects.filter((p) => p.name !== "Home").map((project) => project.id)}
                strategy={verticalListSortingStrategy}
              >
                {projects
                  .filter((p) => p.name !== "Home")
                  .map((project) => {
                    const projectThreads = threads
                      .filter((thread) => thread.projectId === project.id)
                      .toSorted((a, b) => {
                        const byDate =
                          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                        if (byDate !== 0) return byDate;
                        return b.id.localeCompare(a.id);
                      });

                    const filteredProjectThreads = isSearching
                      ? projectThreads.filter((thread) =>
                          thread.title.toLowerCase().includes(normalizedSearchQuery),
                        )
                      : projectThreads;

                    const projectNameMatches = isSearching
                      ? project.name.toLowerCase().includes(normalizedSearchQuery)
                      : true;

                    if (isSearching && !projectNameMatches && filteredProjectThreads.length === 0) {
                      return null;
                    }

                    const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
                    const hasHiddenThreads =
                      !isSearching && filteredProjectThreads.length > THREAD_PREVIEW_LIMIT;
                    const visibleThreads =
                      hasHiddenThreads && !isThreadListExpanded
                        ? filteredProjectThreads.slice(0, THREAD_PREVIEW_LIMIT)
                        : filteredProjectThreads;
                    const orderedProjectThreadIds = filteredProjectThreads.map((t) => t.id);

                    return (
                      <SortableProjectItem key={project.id} projectId={project.id}>
                        {(dragHandleProps) => (
                          <Collapsible className="group/collapsible" open={project.expanded}>
                            <div
                              className="group/project-header relative cursor-grab active:cursor-grabbing"
                              {...dragHandleProps.attributes}
                              {...dragHandleProps.listeners}
                              onPointerDownCapture={handleProjectTitlePointerDownCapture}
                            >
                              <div className="flex items-center gap-0">
                                <button
                                  type="button"
                                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent"
                                  onClick={(event) => handleChevronClick(event, project.id)}
                                >
                                  <ChevronRightIcon
                                    className={`size-3.5 shrink-0 transition-transform duration-150 ${
                                      project.expanded ? "rotate-90" : ""
                                    }`}
                                  />
                                </button>
                                <SidebarMenuButton
                                  size="sm"
                                  className="flex-1 gap-2 px-1 py-1.5 text-left hover:bg-accent group-hover/project-header:text-sidebar-accent-foreground"
                                  onClick={(event) => {
                                    handleProjectTitleClick(event, project.id);
                                    if (event.defaultPrevented) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void navigate({
                                      to: "/project/$projectId",
                                      params: { projectId: project.id },
                                    });
                                  }}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    void handleProjectContextMenu(project.id, {
                                      x: event.clientX,
                                      y: event.clientY,
                                    });
                                  }}
                                >
                                  <ProjectFavicon cwd={project.cwd} projectId={project.id} />
                                  <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                                    {project.name}
                                  </span>
                                </SidebarMenuButton>
                              </div>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <SidebarMenuAction
                                      render={
                                        <button
                                          type="button"
                                          aria-label={`Create new thread in ${project.name}`}
                                        />
                                      }
                                      showOnHover
                                      className="top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void handleNewThread(project.id);
                                      }}
                                    >
                                      <SquarePenIcon className="size-3.5" />
                                    </SidebarMenuAction>
                                  }
                                />
                                <TooltipPopup side="top">
                                  {newThreadShortcutLabel
                                    ? `New thread (${newThreadShortcutLabel})`
                                    : "New thread"}
                                </TooltipPopup>
                              </Tooltip>
                            </div>

                            <CollapsibleContent keepMounted>
                              <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0">
                                {visibleThreads.map((thread) => {
                                  const isActive = routeThreadId === thread.id;
                                  const isSelected = selectedThreadIds.has(thread.id);
                                  const isHighlighted = isActive || isSelected;
                                  const threadStatus = resolveThreadStatusPill({
                                    thread,
                                    hasPendingApprovals:
                                      pendingApprovalByThreadId.get(thread.id) === true,
                                    hasPendingUserInput:
                                      pendingUserInputByThreadId.get(thread.id) === true,
                                  });
                                  const prStatus = prStatusIndicator(
                                    prByThreadId.get(thread.id) ?? null,
                                  );
                                  const terminalStatus = terminalStatusFromRunningIds(
                                    selectThreadTerminalState(terminalStateByThreadId, thread.id)
                                      .runningTerminalIds,
                                  );

                                  return (
                                    <SidebarMenuSubItem
                                      key={thread.id}
                                      className="w-full"
                                      data-thread-item
                                    >
                                      <SidebarMenuSubButton
                                        render={<div role="button" tabIndex={0} />}
                                        size="sm"
                                        isActive={isActive}
                                        className={`h-7 w-full translate-x-0 cursor-default justify-start px-2 text-left select-none hover:bg-accent hover:text-foreground focus-visible:ring-0 ${
                                          isSelected
                                            ? "bg-primary/15 text-foreground dark:bg-primary/10"
                                            : isActive
                                              ? "bg-accent/85 text-foreground font-medium dark:bg-accent/55"
                                              : "text-muted-foreground"
                                        }`}
                                        onClick={(event) => {
                                          handleThreadClick(
                                            event,
                                            thread.id,
                                            orderedProjectThreadIds,
                                          );
                                        }}
                                        onKeyDown={(event) => {
                                          if (event.key !== "Enter" && event.key !== " ") return;
                                          event.preventDefault();
                                          if (selectedThreadIds.size > 0) {
                                            clearSelection();
                                          }
                                          setSelectionAnchor(thread.id);
                                          void navigate({
                                            to: "/$threadId",
                                            params: { threadId: thread.id },
                                          });
                                        }}
                                        onContextMenu={(event) => {
                                          event.preventDefault();
                                          if (
                                            selectedThreadIds.size > 0 &&
                                            selectedThreadIds.has(thread.id)
                                          ) {
                                            void handleMultiSelectContextMenu({
                                              x: event.clientX,
                                              y: event.clientY,
                                            });
                                          } else {
                                            if (selectedThreadIds.size > 0) {
                                              clearSelection();
                                            }
                                            void handleThreadContextMenu(thread.id, {
                                              x: event.clientX,
                                              y: event.clientY,
                                            });
                                          }
                                        }}
                                      >
                                        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                                          {prStatus && (
                                            <Tooltip>
                                              <TooltipTrigger
                                                render={
                                                  <button
                                                    type="button"
                                                    aria-label={prStatus.tooltip}
                                                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                                                    onClick={(event) => {
                                                      openPrLink(event, prStatus.url);
                                                    }}
                                                  >
                                                    <GitPullRequestIcon className="size-3" />
                                                  </button>
                                                }
                                              />
                                              <TooltipPopup side="top">
                                                {prStatus.tooltip}
                                              </TooltipPopup>
                                            </Tooltip>
                                          )}
                                          {threadStatus && (
                                            <span
                                              className={`inline-flex items-center gap-1 text-[10px] ${threadStatus.colorClass}`}
                                            >
                                              <span
                                                className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                                                  threadStatus.pulse ? "animate-pulse" : ""
                                                }`}
                                              />
                                              <span className="hidden md:inline">
                                                {threadStatus.label}
                                              </span>
                                            </span>
                                          )}
                                          {renamingThreadId === thread.id ? (
                                            <input
                                              ref={(el) => {
                                                if (el && renamingInputRef.current !== el) {
                                                  renamingInputRef.current = el;
                                                  el.focus();
                                                  el.select();
                                                }
                                              }}
                                              className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
                                              value={renamingTitle}
                                              onChange={(e) => setRenamingTitle(e.target.value)}
                                              onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  renamingCommittedRef.current = true;
                                                  void commitRename(
                                                    thread.id,
                                                    renamingTitle,
                                                    thread.title,
                                                  );
                                                } else if (e.key === "Escape") {
                                                  e.preventDefault();
                                                  renamingCommittedRef.current = true;
                                                  cancelRename();
                                                }
                                              }}
                                              onBlur={() => {
                                                if (!renamingCommittedRef.current) {
                                                  void commitRename(
                                                    thread.id,
                                                    renamingTitle,
                                                    thread.title,
                                                  );
                                                }
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                          ) : (
                                            <span className="min-w-0 flex-1 truncate text-xs">
                                              {thread.title}
                                            </span>
                                          )}
                                        </div>
                                        <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                          {terminalStatus && (
                                            <span
                                              role="img"
                                              aria-label={terminalStatus.label}
                                              title={terminalStatus.label}
                                              className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                                            >
                                              <TerminalIcon
                                                className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`}
                                              />
                                            </span>
                                          )}
                                          <span
                                            className={`text-[10px] ${
                                              isHighlighted
                                                ? "text-foreground/65"
                                                : "text-muted-foreground/40"
                                            }`}
                                          >
                                            {formatRelativeTime(thread.createdAt)}
                                          </span>
                                        </div>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  );
                                })}

                                {hasHiddenThreads && !isThreadListExpanded && (
                                  <SidebarMenuSubItem className="w-full">
                                    <SidebarMenuSubButton
                                      render={<button type="button" />}
                                      data-thread-selection-safe
                                      size="sm"
                                      className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                                      onClick={() => {
                                        expandThreadListForProject(project.id);
                                      }}
                                    >
                                      <span>Show more</span>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )}
                                {hasHiddenThreads && isThreadListExpanded && (
                                  <SidebarMenuSubItem className="w-full">
                                    <SidebarMenuSubButton
                                      render={<button type="button" />}
                                      data-thread-selection-safe
                                      size="sm"
                                      className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                                      onClick={() => {
                                        collapseThreadListForProject(project.id);
                                      }}
                                    >
                                      <span>Show less</span>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )}
                              </SidebarMenuSub>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                      </SortableProjectItem>
                    );
                  })}
              </SortableContext>
            </SidebarMenu>
          </DndContext>

          {projects.length === 0 && !showAddProjectDialog && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No projects yet
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <AccountPill />
        <SidebarMenu>
          <SidebarMenuItem>
            {isOnSettings ? (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => window.history.back()}
              >
                <ArrowLeftIcon className="size-3.5" />
                <span className="text-xs">Back</span>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                size="sm"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                onClick={() => void navigate({ to: "/settings" })}
              >
                <SettingsIcon className="size-3.5" />
                <span className="text-xs">Settings</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Project Settings Dialog */}
      {settingsDialogProjectId &&
        (() => {
          const project = projects.find((p) => p.id === settingsDialogProjectId);
          if (!project) return null;
          return (
            <ProjectSettingsDialog
              open
              onOpenChange={(open) => {
                if (!open) setSettingsDialogProjectId(null);
              }}
              projectId={project.id}
              projectName={project.name}
              projectCwd={project.cwd}
            />
          );
        })()}

      {/* Add Project Dialog */}
      <Dialog
        open={showAddProjectDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddProjectDialog(false);
            setAddProjectError(null);
            setNewCwd("");
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Project</DialogTitle>
            <DialogDescription>Add a project folder to T3 Code.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-3">
              {isElectron && (
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-2.5 text-sm text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handlePickFolder()}
                  disabled={isPickingFolder || isAddingProject}
                >
                  <FolderIcon className="size-4" />
                  {isPickingFolder ? "Picking folder..." : "Browse for folder"}
                </button>
              )}
              <div className="flex gap-2">
                <input
                  ref={addProjectInputRef}
                  className={`min-w-0 flex-1 rounded-md border bg-secondary px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
                    addProjectError
                      ? "border-red-500/70 focus:border-red-500"
                      : "border-border focus:border-ring"
                  }`}
                  placeholder="/path/to/project"
                  value={newCwd}
                  onChange={(event) => {
                    setNewCwd(event.target.value);
                    setAddProjectError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleAddProject();
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                  onClick={handleAddProject}
                  disabled={!canAddProject}
                >
                  {isAddingProject ? "Adding..." : "Add"}
                </button>
              </div>
              {addProjectError && (
                <p className="text-[11px] leading-tight text-red-400">{addProjectError}</p>
              )}
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

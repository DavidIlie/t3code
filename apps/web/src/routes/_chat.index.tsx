import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type {
  ModelSlug,
  ProjectId,
  ProviderInteractionMode,
  ProviderKind,
  RuntimeMode,
} from "@t3tools/contracts";
import { DEFAULT_MODEL_BY_PROVIDER, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import { getDefaultModel } from "@t3tools/shared/model";
import {
  BotIcon,
  FolderIcon,
  FolderOpenIcon,
  HomeIcon,
  LockIcon,
  LockOpenIcon,
  MonitorIcon,
  SendIcon,
  TerminalIcon,
} from "lucide-react";

import { ProjectFavicon } from "../components/Sidebar";
import { isElectron } from "../env";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useComposerDraftStore, type ComposerImageAttachment } from "../composerDraftStore";
import { useAppSettings } from "../appSettings";
import { newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import ProviderModelPicker, {
  getCustomModelOptionsByProvider,
} from "../components/ProviderModelPicker";
import { SidebarTrigger } from "../components/ui/sidebar";
import { useTerminalStateStore } from "../terminalStateStore";

// ── @scope parser ───────────────────────────────────────────────────

interface ScopeParseResult {
  path: string;
  message: string;
}

function parseScope(text: string): ScopeParseResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("@scope ")) return null;
  const rest = trimmed.slice(7).trimStart();
  if (!rest) return null;

  // Quoted path: @scope "/path with spaces" message
  if (rest.startsWith('"')) {
    const closeQuote = rest.indexOf('"', 1);
    if (closeQuote === -1) return null;
    return {
      path: rest.slice(1, closeQuote),
      message: rest.slice(closeQuote + 1).trim(),
    };
  }

  // Unquoted path: @scope /path/to/dir message here
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) {
    return { path: rest, message: "" };
  }
  return {
    path: rest.slice(0, spaceIdx),
    message: rest.slice(spaceIdx + 1).trim(),
  };
}

// ── Detect live @scope while typing ─────────────────────────────────

function detectScopePrefix(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("@scope ")) return null;
  const rest = trimmed.slice(7).trimStart();
  if (!rest) return null;
  if (rest.startsWith('"')) {
    const closeQuote = rest.indexOf('"', 1);
    if (closeQuote === -1) return rest.slice(1);
    return rest.slice(1, closeQuote);
  }
  const spaceIdx = rest.indexOf(" ");
  return spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

// ── Autocomplete types ──────────────────────────────────────────────

interface AutocompleteItem {
  id: string;
  label: string;
  description: string;
  icon: "command" | "project" | "directory" | "home";
  /** The text to insert when this item is selected */
  insertText: string;
}

type MenuPhase = "closed" | "command" | "path";

const SYSTEM_DIRECTORIES: { label: string; path: string; icon: AutocompleteItem["icon"] }[] = [
  { label: "Home", path: "~/", icon: "home" },
  { label: "Desktop", path: "~/Desktop", icon: "directory" },
  { label: "Documents", path: "~/Documents", icon: "directory" },
  { label: "Downloads", path: "~/Downloads", icon: "directory" },
  { label: "Developer", path: "~/Developer", icon: "directory" },
  { label: "dev", path: "~/dev", icon: "directory" },
  { label: "Projects", path: "~/Projects", icon: "directory" },
  { label: "src", path: "~/src", icon: "directory" },
  { label: "Code", path: "~/Code", icon: "directory" },
];

// ── Component ───────────────────────────────────────────────────────

function HomePage() {
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const [prompt, setPrompt] = useState("");
  const { settings, updateSettings } = useAppSettings();
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(settings.defaultProvider);
  const [selectedModel, setSelectedModel] = useState<ModelSlug>(
    (settings.defaultModel as ModelSlug) || getDefaultModel(settings.defaultProvider),
  );
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(DEFAULT_RUNTIME_MODE);
  const [interactionMode, setInteractionMode] =
    useState<ProviderInteractionMode>(DEFAULT_INTERACTION_MODE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const setProjectDraftThreadId = useComposerDraftStore((s) => s.setProjectDraftThreadId);
  const setComposerPrompt = useComposerDraftStore((s) => s.setPrompt);
  const setComposerDraftProvider = useComposerDraftStore((s) => s.setProvider);
  const setComposerDraftModel = useComposerDraftStore((s) => s.setModel);
  const setComposerDraftRuntimeMode = useComposerDraftStore((s) => s.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore((s) => s.setInteractionMode);
  const markAutoSubmit = useComposerDraftStore((s) => s.markAutoSubmit);
  const addDraftImages = useComposerDraftStore((s) => s.addImages);

  const modelOptionsByProvider = useMemo(
    () => getCustomModelOptionsByProvider(settings),
    [settings],
  );

  const homeProject = useMemo(() => projects.find((p) => p.name === "Home"), [projects]);

  const nonHomeProjects = useMemo(() => projects.filter((p) => p.name !== "Home"), [projects]);

  const recentThreads = useMemo(
    () =>
      threads
        .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [threads],
  );

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Live @scope detection for the indicator
  const scopePath = useMemo(() => detectScopePrefix(prompt), [prompt]);

  // ── Autocomplete logic ──────────────────────────────────────────
  const menuPhase: MenuPhase = useMemo(() => {
    // Use raw prompt (not trimmed) so trailing space after @scope is detected
    // Phase: @scope followed by space — entering path
    if (/^@scope\s+/i.test(prompt)) {
      // Only show menu while still typing the path (no space after the path token)
      const afterScope = prompt.slice(7).trimStart();
      if (afterScope.indexOf(" ") === -1) {
        return "path";
      }
      return "closed";
    }
    // Phase: typing @ but haven't completed @scope + space yet
    if (/^@(?:s(?:c(?:o(?:p(?:e)?)?)?)?)?$/i.test(prompt.trim())) {
      return "command";
    }
    return "closed";
  }, [prompt]);

  const menuItems: AutocompleteItem[] = useMemo(() => {
    if (menuPhase === "command") {
      return [
        {
          id: "cmd-scope",
          label: "@scope",
          description: "Scope to a project directory",
          icon: "command",
          insertText: "@scope ",
        },
      ];
    }

    if (menuPhase === "path") {
      const query = prompt.trim().slice(7).trimStart().toLowerCase();
      const items: AutocompleteItem[] = [];

      // Add existing projects
      for (const project of nonHomeProjects) {
        const matchesQuery =
          !query ||
          project.name.toLowerCase().includes(query) ||
          project.cwd.toLowerCase().includes(query);
        if (matchesQuery) {
          items.push({
            id: `project-${project.id}`,
            label: project.name,
            description: project.cwd,
            icon: "project",
            insertText: `@scope ${project.cwd} `,
          });
        }
      }

      // Add system directories (filtered, skip ones that match existing projects)
      const projectPaths = new Set(nonHomeProjects.map((p) => p.cwd));
      for (const dir of SYSTEM_DIRECTORIES) {
        if (projectPaths.has(dir.path)) continue;
        const matchesQuery =
          !query ||
          dir.label.toLowerCase().includes(query) ||
          dir.path.toLowerCase().includes(query);
        if (matchesQuery) {
          items.push({
            id: `dir-${dir.path}`,
            label: dir.label,
            description: dir.path,
            icon: dir.icon,
            insertText: `@scope ${dir.path} `,
          });
        }
      }

      return items;
    }

    return [];
  }, [menuPhase, prompt, nonHomeProjects]);

  const menuOpen = menuItems.length > 0;

  // Reset highlight when items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [menuItems.length, menuPhase]);

  const selectMenuItem = useCallback((item: AutocompleteItem) => {
    setPrompt(item.insertText);
    // Focus textarea and place cursor at end
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = item.insertText.length;
        ta.selectionEnd = item.insertText.length;
      }
    });
  }, []);

  const handlePasteImages = useCallback(
    async (files: File[]) => {
      if (!homeProject) return;
      const images: ComposerImageAttachment[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) continue;
        images.push({
          type: "image",
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl: URL.createObjectURL(file),
          file,
        });
      }
      if (images.length === 0) return;

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      setProjectDraftThreadId(homeProject.id, threadId, {
        createdAt,
        branch: null,
        worktreePath: null,
        envMode: "local",
        runtimeMode,
        interactionMode,
      });

      if (prompt.trim()) {
        setComposerPrompt(threadId, prompt);
      }
      setComposerDraftProvider(threadId, selectedProvider);
      setComposerDraftModel(threadId, selectedModel);
      setComposerDraftRuntimeMode(threadId, runtimeMode);
      setComposerDraftInteractionMode(threadId, interactionMode);
      addDraftImages(threadId, images);

      await navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      homeProject,
      navigate,
      setProjectDraftThreadId,
      setComposerPrompt,
      setComposerDraftProvider,
      setComposerDraftModel,
      setComposerDraftRuntimeMode,
      setComposerDraftInteractionMode,
      addDraftImages,
      selectedProvider,
      selectedModel,
      runtimeMode,
      interactionMode,
      prompt,
    ],
  );

  // Find or create a project for the given path, returns the projectId
  const findOrCreateProject = useCallback(
    async (cwd: string): Promise<ProjectId | null> => {
      // Check existing projects
      const existing = projects.find((p) => p.cwd === cwd);
      if (existing) return existing.id;

      const api = readNativeApi();
      if (!api) return null;

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
        return projectId;
      } catch {
        return null;
      }
    },
    [projects],
  );

  const createThreadInProject = useCallback(
    async (projectId: ProjectId, message: string) => {
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      setProjectDraftThreadId(projectId, threadId, {
        createdAt,
        branch: null,
        worktreePath: null,
        envMode: "local",
        runtimeMode,
        interactionMode,
      });

      if (message) {
        setComposerPrompt(threadId, message);
        markAutoSubmit(threadId);
      }
      setComposerDraftProvider(threadId, selectedProvider);
      setComposerDraftModel(threadId, selectedModel);
      setComposerDraftRuntimeMode(threadId, runtimeMode);
      setComposerDraftInteractionMode(threadId, interactionMode);

      await navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      navigate,
      setProjectDraftThreadId,
      setComposerPrompt,
      setComposerDraftProvider,
      setComposerDraftModel,
      setComposerDraftRuntimeMode,
      setComposerDraftInteractionMode,
      markAutoSubmit,
      selectedProvider,
      selectedModel,
      runtimeMode,
      interactionMode,
    ],
  );

  const handleSubmit = useCallback(
    async (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      const trimmed = prompt.trim();
      if (!trimmed) return;

      // Check for @scope syntax
      const scope = parseScope(trimmed);
      if (scope) {
        const projectId = await findOrCreateProject(scope.path);
        if (projectId) {
          await createThreadInProject(projectId, scope.message);
          setPrompt("");
        }
        return;
      }

      // Default: create thread in Home project
      if (!homeProject) return;
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      setProjectDraftThreadId(homeProject.id, threadId, {
        createdAt,
        branch: null,
        worktreePath: null,
        envMode: "local",
        runtimeMode,
        interactionMode,
      });

      setComposerPrompt(threadId, trimmed);
      setComposerDraftProvider(threadId, selectedProvider);
      setComposerDraftModel(threadId, selectedModel);
      setComposerDraftRuntimeMode(threadId, runtimeMode);
      setComposerDraftInteractionMode(threadId, interactionMode);
      markAutoSubmit(threadId);

      setPrompt("");
      await navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      prompt,
      homeProject,
      navigate,
      findOrCreateProject,
      createThreadInProject,
      setProjectDraftThreadId,
      setComposerPrompt,
      setComposerDraftProvider,
      setComposerDraftModel,
      setComposerDraftRuntimeMode,
      setComposerDraftInteractionMode,
      markAutoSubmit,
      selectedProvider,
      selectedModel,
      runtimeMode,
      interactionMode,
    ],
  );

  const openTerminal = useCallback(async () => {
    if (!homeProject) return;
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();

    setProjectDraftThreadId(homeProject.id, threadId, {
      createdAt,
      branch: null,
      worktreePath: null,
      envMode: "local",
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });

    // Pre-set terminal to open before navigation
    useTerminalStateStore.getState().setTerminalOpen(threadId, true);

    await navigate({
      to: "/$threadId",
      params: { threadId },
    });
  }, [homeProject, navigate, setProjectDraftThreadId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (menuOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlightedIndex((i) => (i + 1) % menuItems.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlightedIndex((i) => (i - 1 + menuItems.length) % menuItems.length);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          const item = menuItems[highlightedIndex];
          if (item) {
            selectMenuItem(item);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          // Clear to dismiss menu
          setPrompt("");
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [menuOpen, menuItems, highlightedIndex, selectMenuItem, handleSubmit],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium">Home</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs text-muted-foreground/50">Home</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4">
        <div className="w-full max-w-2xl space-y-8 my-12">
          {/* Header */}
          <div className="text-center">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-secondary/50 px-3 py-1 text-[11px] text-muted-foreground/60">
              <HomeIcon className="size-3" />
              <span>~/</span>
            </div>
            <h1 className="text-2xl font-semibold">T3 Gurt</h1>
            <p className="mt-1 text-sm text-muted-foreground/60">
              Ask anything, or type{" "}
              <span className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px] text-muted-foreground/80">
                @scope
              </span>{" "}
              to work in a project
            </p>
          </div>

          {/* Central input */}
          {homeProject ? (
            <div>
              <div className="relative">
                {/* Scope indicator */}
                {scopePath && !menuOpen && (
                  <div className="absolute -top-7 left-0 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                    <FolderOpenIcon className="size-3" />
                    <span>
                      Scoping to <span className="font-mono text-foreground/80">{scopePath}</span>
                    </span>
                  </div>
                )}

                {/* Autocomplete popup */}
                {menuOpen && (
                  <div className="absolute bottom-full left-0 z-50 mb-1.5 w-full">
                    <div className="overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg backdrop-blur-sm">
                      <div className="max-h-64 overflow-y-auto py-1">
                        {menuPhase === "command" && (
                          <div className="px-2 pb-1 pt-1.5">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                              Commands
                            </p>
                          </div>
                        )}
                        {menuPhase === "path" && (
                          <div className="px-2 pb-1 pt-1.5">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
                              Scope to directory
                            </p>
                          </div>
                        )}
                        {menuItems.map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-xs transition-colors ${
                              index === highlightedIndex
                                ? "bg-accent text-accent-foreground"
                                : "text-foreground hover:bg-accent/50"
                            }`}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectMenuItem(item);
                            }}
                          >
                            {item.icon === "command" && (
                              <MonitorIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                            )}
                            {item.icon === "project" && (
                              <FolderOpenIcon className="size-3.5 shrink-0 text-primary/70" />
                            )}
                            {item.icon === "directory" && (
                              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                            )}
                            {item.icon === "home" && (
                              <HomeIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                            )}
                            <span className="min-w-0 truncate font-medium">{item.label}</span>
                            <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground/50">
                              {item.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                  placeholder="Ask anything, or type @ to scope a project..."
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files).filter((f) =>
                      f.type.startsWith("image/"),
                    );
                    if (files.length > 0) {
                      e.preventDefault();
                      void handlePasteImages(files);
                    }
                  }}
                />
                <button
                  type="button"
                  className="absolute bottom-3 right-3 rounded-lg bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                  disabled={!prompt.trim()}
                  onClick={() => void handleSubmit()}
                >
                  <SendIcon className="size-4" />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <ProviderModelPicker
                    provider={selectedProvider}
                    model={selectedModel}
                    lockedProvider={null}
                    modelOptionsByProvider={modelOptionsByProvider}
                    onProviderModelChange={(provider, model) => {
                      setSelectedProvider(provider);
                      setSelectedModel(model);
                      updateSettings({ defaultProvider: provider, defaultModel: model });
                    }}
                  />
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() =>
                      setInteractionMode(interactionMode === "plan" ? "default" : "plan")
                    }
                    title={
                      interactionMode === "plan"
                        ? "Plan mode — click to return to agent mode"
                        : "Agent mode — click to enter plan mode"
                    }
                  >
                    <BotIcon className="size-3.5" />
                    <span className="hidden sm:inline">
                      {interactionMode === "plan" ? "Plan" : "Agent"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() =>
                      setRuntimeMode(
                        runtimeMode === "full-access" ? "approval-required" : "full-access",
                      )
                    }
                    title={
                      runtimeMode === "full-access"
                        ? "Full access — click to require approvals"
                        : "Approval required — click for full access"
                    }
                  >
                    {runtimeMode === "full-access" ? (
                      <LockOpenIcon className="size-3.5" />
                    ) : (
                      <LockIcon className="size-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {runtimeMode === "full-access" ? "Full access" : "Supervised"}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => void openTerminal()}
                >
                  <TerminalIcon className="size-3.5" />
                  <span>Terminal</span>
                </button>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground/40">Loading...</p>
          )}

          {/* Quick scope shortcuts for existing projects */}
          {nonHomeProjects.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
                Projects
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {nonHomeProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="group flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2.5 text-left text-xs transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      setPrompt(`@scope ${project.cwd} `);
                      textareaRef.current?.focus();
                    }}
                  >
                    <ProjectFavicon cwd={project.cwd} projectId={project.id} size="sm" />
                    <span className="min-w-0 truncate text-foreground/80">{project.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recent threads */}
          {recentThreads.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
                Recent
              </h2>
              <div className="space-y-0.5">
                {recentThreads.map((thread) => {
                  const threadProject = projects.find((p) => p.id === thread.projectId);
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-foreground/80 transition-colors hover:bg-accent"
                      onClick={() =>
                        void navigate({
                          to: "/$threadId",
                          params: { threadId: thread.id },
                        })
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                      {threadProject && threadProject.name !== "Home" && (
                        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                          {threadProject.name}
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] text-muted-foreground/40">
                        {new Date(thread.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: HomePage,
});

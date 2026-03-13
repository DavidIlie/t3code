import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type {
  ModelSlug,
  ProviderInteractionMode,
  ProviderKind,
  RuntimeMode,
} from "@t3tools/contracts";
import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import { getDefaultModel } from "@t3tools/shared/model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BotIcon,
  ShieldCheckIcon,
  PlusCircleIcon,
  BugIcon,
  GitPullRequestIcon,
  PlayIcon,
  SendIcon,
  TerminalIcon,
  CloudUploadIcon,
  LockIcon,
  LockOpenIcon,
} from "lucide-react";
import { useStore } from "../store";
import { useComposerDraftStore, type ComposerImageAttachment } from "../composerDraftStore";
import { useAppSettings } from "../appSettings";
import { newThreadId } from "../lib/utils";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { isElectron } from "../env";
import { gitStatusQueryOptions } from "../lib/gitReactQuery";
import { gitPushWithToast } from "../lib/gitPushWithToast";
import ProviderModelPicker, { getCustomModelOptionsByProvider } from "./ProviderModelPicker";
import { SidebarTrigger } from "./ui/sidebar";
import { useTerminalStateStore } from "../terminalStateStore";

const QUICK_ACTIONS = [
  {
    label: "Audit this codebase",
    icon: ShieldCheckIcon,
    prompt: "Audit this codebase for issues, security vulnerabilities, and improvements.",
  },
  {
    label: "Add a new feature",
    icon: PlusCircleIcon,
    prompt: "Help me plan and implement a new feature.",
  },
  {
    label: "Fix a bug",
    icon: BugIcon,
    prompt: "Help me investigate and fix a bug.",
  },
  {
    label: "Review recent changes",
    icon: GitPullRequestIcon,
    prompt: "Review the recent git changes and provide feedback.",
  },
  {
    label: "Run tests",
    icon: PlayIcon,
    prompt: "Run the test suite and analyze results.",
  },
] as const;

export default function ProjectLandingPage() {
  const { projectId } = useParams({ from: "/_chat/project/$projectId" });
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const project = projects.find((p) => p.id === projectId);
  const [prompt, setPrompt] = useState("");
  const { settings, updateSettings } = useAppSettings();
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(settings.defaultProvider);
  const [selectedModel, setSelectedModel] = useState<ModelSlug>(
    (settings.defaultModel as ModelSlug) || getDefaultModel(settings.defaultProvider),
  );
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("full-access");
  const [interactionMode, setInteractionMode] =
    useState<ProviderInteractionMode>(DEFAULT_INTERACTION_MODE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const queryClient = useQueryClient();

  const setProjectDraftThreadId = useComposerDraftStore((s) => s.setProjectDraftThreadId);
  const setComposerPrompt = useComposerDraftStore((s) => s.setPrompt);
  const setComposerDraftProvider = useComposerDraftStore((s) => s.setProvider);
  const setComposerDraftModel = useComposerDraftStore((s) => s.setModel);
  const setComposerDraftRuntimeMode = useComposerDraftStore((s) => s.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore((s) => s.setInteractionMode);
  const markAutoSubmit = useComposerDraftStore((s) => s.markAutoSubmit);
  const addDraftImages = useComposerDraftStore((s) => s.addImages);

  const { data: gitStatus } = useQuery(gitStatusQueryOptions(project?.cwd ?? null));
  const hasGitChanges = gitStatus?.hasWorkingTreeChanges || (gitStatus?.aheadCount ?? 0) > 0;
  const [isPushing, setIsPushing] = useState(false);

  const handlePush = useCallback(async () => {
    if (!project || isPushing) return;
    setIsPushing(true);
    try {
      await gitPushWithToast({
        cwd: project.cwd,
        action: "commit_push",
        queryClient,
      });
    } catch {
      // Error already shown via toast
    } finally {
      setIsPushing(false);
    }
  }, [project, isPushing, queryClient]);

  const modelOptionsByProvider = useMemo(
    () => getCustomModelOptionsByProvider(settings),
    [settings],
  );

  const projectThreads = threads
    .filter((t) => t.projectId === projectId)
    .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handlePasteImages = useCallback(
    async (files: File[]) => {
      if (!project) return;
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

      setProjectDraftThreadId(project.id, threadId, {
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
      project,
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

  const createThreadWithPrompt = useCallback(
    async (text: string, options?: { autoSubmit?: boolean }) => {
      if (!text.trim() || !project) return;
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      setProjectDraftThreadId(project.id, threadId, {
        createdAt,
        branch: null,
        worktreePath: null,
        envMode: "local",
        runtimeMode,
        interactionMode,
      });

      setComposerPrompt(threadId, text);
      setComposerDraftProvider(threadId, selectedProvider);
      setComposerDraftModel(threadId, selectedModel);
      setComposerDraftRuntimeMode(threadId, runtimeMode);
      setComposerDraftInteractionMode(threadId, interactionMode);
      if (options?.autoSubmit) {
        markAutoSubmit(threadId);
      }

      await navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      project,
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
    (e?: { preventDefault: () => void }) => {
      e?.preventDefault();
      void createThreadWithPrompt(prompt, { autoSubmit: true });
    },
    [createThreadWithPrompt, prompt],
  );

  const openTerminal = useCallback(async () => {
    if (!project) return;
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();

    setProjectDraftThreadId(project.id, threadId, {
      createdAt,
      branch: null,
      worktreePath: null,
      envMode: "local",
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });

    useTerminalStateStore.getState().setTerminalOpen(threadId, true);

    await navigate({
      to: "/$threadId",
      params: { threadId },
    });
  }, [project, navigate, setProjectDraftThreadId]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/60">Project not found</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium">{project.name}</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs text-muted-foreground/50">{project.name}</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4">
        <div className="w-full max-w-2xl space-y-8 my-12">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground/60 font-mono">{project.cwd}</p>
          </div>

          {/* Central input */}
          <div>
            <div className="relative">
              <textarea
                ref={textareaRef}
                className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                placeholder="What can I help you with?"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
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
                onClick={() => handleSubmit()}
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

          {/* Quick actions */}
          <div>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
              Quick actions
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/50 px-3 py-2.5 text-left text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => void createThreadWithPrompt(action.prompt)}
                >
                  <action.icon className="size-4 shrink-0 text-muted-foreground/70" />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Git actions */}
          {gitStatus && (
            <div>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
                Git
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/50 px-3 py-2.5 text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
                  disabled={!hasGitChanges || isPushing}
                  onClick={() => void handlePush()}
                >
                  <CloudUploadIcon className="size-4 shrink-0 text-muted-foreground/70" />
                  <span>{isPushing ? "Pushing..." : "Push to GitHub"}</span>
                </button>
                {gitStatus.branch && (
                  <span className="text-[10px] text-muted-foreground/50">
                    {gitStatus.branch}
                    {gitStatus.hasWorkingTreeChanges && " (uncommitted changes)"}
                    {gitStatus.aheadCount > 0 && ` (${gitStatus.aheadCount} ahead)`}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Recent threads */}
          {projectThreads.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
                Recent threads
              </h2>
              <div className="space-y-1">
                {projectThreads.map((thread) => (
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
                    <span className="shrink-0 text-[10px] text-muted-foreground/40">
                      {new Date(thread.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

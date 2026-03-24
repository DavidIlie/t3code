import { type DiffLineAnnotation, parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { DEFAULT_RUNTIME_MODE, type ProjectId, ThreadId } from "@t3tools/contracts";
import { ArrowLeftIcon, CalendarIcon, MessageSquareIcon, SearchIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  gitBranchesQueryOptions,
  gitCommitDiffQueryOptions,
  gitLogQueryOptions,
} from "~/lib/gitReactQuery";
import { cn, newThreadId } from "~/lib/utils";
import { useComposerDraftStore } from "../composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import {
  DiffContextCommentDraft as DiffContextCommentDraftCard,
  DiffContextCommentPreview,
} from "./DiffContextCommentDraft";
import {
  buildFileDiffRenderKey,
  type DiffCommentAnnotationMetadata,
  resolveFileDiffPath,
  useDiffContextCommentDrafts,
} from "./DiffPanel.logic";
import { parseDiffRouteSearch, stripHistorySearchParams } from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import { buildPatchCacheKey, resolveDiffThemeName } from "../lib/diffRendering";
import { useStore } from "../store";
import { openInPreferredEditor } from "../editorPreferences";
import { readNativeApi } from "../nativeApi";
import { resolvePathLinkTarget } from "../terminal-links";

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

const LOG_PAGE_SIZE = 50;

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

function getRenderableFiles(patch: string | undefined, cacheScope: string): FileDiffMetadata[] {
  if (!patch) return [];
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return [];
  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    return parsedPatches
      .flatMap((p) => p.files)
      .toSorted((left, right) =>
        resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
  } catch {
    return [];
  }
}

export default function GitHistoryPanel({
  mode = "sidebar",
  onClose,
}: {
  mode?: DiffPanelMode;
  onClose?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const routeParams = useParams({
    strict: false,
    select: (params) => ({
      threadId: params.threadId ? ThreadId.makeUnsafe(params.threadId) : null,
      projectId:
        ((params as Record<string, string | undefined>).projectId as ProjectId | undefined) ?? null,
    }),
  });
  const routeThreadId = routeParams.threadId;
  const routeProjectId = routeParams.projectId;
  const search = useSearch({ strict: false, select: (s) => parseDiffRouteSearch(s) });
  const selectedCommitHash = search.historyCommit ?? null;

  const activeThread = useStore((store) =>
    routeThreadId ? store.threads.find((t) => t.id === routeThreadId) : undefined,
  );
  // On project route, resolve project directly from projectId param
  const activeProject = useStore((store) => {
    if (routeProjectId) return store.projects.find((p) => p.id === routeProjectId);
    if (activeThread?.projectId) return store.projects.find((p) => p.id === activeThread.projectId);
    return undefined;
  });
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;

  const gitBranchesQuery = useQuery(gitBranchesQueryOptions(activeCwd));
  const currentBranch = gitBranchesQuery.data?.branches.find((b) => b.current)?.name ?? null;

  // ── Search / filter state ─────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sinceDate, setSinceDate] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Pagination: accumulate commits in state, single query for latest page
  const [skipOffset, setSkipOffset] = useState(0);
  const [accumulatedCommits, setAccumulatedCommits] = useState<
    ReadonlyArray<{
      readonly hash: string;
      readonly abbreviatedHash: string;
      readonly subject: string;
      readonly authorName: string;
      readonly authorDate: string;
    }>
  >([]);
  const lastAppendedOffset = useRef(0);

  // Reset pagination when search changes
  const prevSearchRef = useRef({ search: "", since: "", until: "" });
  useEffect(() => {
    const prev = prevSearchRef.current;
    if (prev.search !== debouncedSearch || prev.since !== sinceDate || prev.until !== untilDate) {
      prevSearchRef.current = { search: debouncedSearch, since: sinceDate, until: untilDate };
      setSkipOffset(0);
      setAccumulatedCommits([]);
      lastAppendedOffset.current = 0;
    }
  }, [debouncedSearch, sinceDate, untilDate]);

  const logQueryInput: Parameters<typeof gitLogQueryOptions>[0] = {
    cwd: activeCwd,
    limit: LOG_PAGE_SIZE,
    skip: skipOffset,
  };
  if (debouncedSearch) logQueryInput.search = debouncedSearch;
  if (sinceDate) logQueryInput.since = sinceDate;
  if (untilDate) logQueryInput.until = untilDate;
  const logQuery = useQuery(gitLogQueryOptions(logQueryInput));

  // Append new commits when query data changes
  if (logQuery.data && lastAppendedOffset.current !== skipOffset + 1) {
    lastAppendedOffset.current = skipOffset + 1;
    if (skipOffset === 0) {
      setAccumulatedCommits(logQuery.data.commits);
    } else {
      setAccumulatedCommits((prev) => {
        const existingHashes = new Set(prev.map((c) => c.hash));
        const newCommits = logQuery.data.commits.filter((c) => !existingHashes.has(c.hash));
        return [...prev, ...newCommits];
      });
    }
  }

  const allCommits = accumulatedCommits;
  const hasMore = logQuery.data?.hasMore ?? false;
  const isLoadingMore = logQuery.isLoading;

  const commitDiffQuery = useQuery(
    gitCommitDiffQueryOptions({ cwd: activeCwd, commitHash: selectedCommitHash }),
  );

  const navigateWithSearch = useCallback(
    (searchUpdater: (previous: Record<string, unknown>) => Record<string, unknown>) => {
      if (routeThreadId) {
        void navigate({
          to: "/$threadId",
          params: { threadId: routeThreadId },
          search: searchUpdater as never,
        });
      } else if (routeProjectId) {
        void navigate({
          to: "/project/$projectId",
          params: { projectId: routeProjectId },
          search: searchUpdater as never,
        });
      }
    },
    [navigate, routeThreadId, routeProjectId],
  );

  const selectCommit = useCallback(
    (hash: string) => {
      navigateWithSearch((previous) => ({
        ...previous,
        history: "1" as const,
        historyCommit: hash,
      }));
    },
    [navigateWithSearch],
  );

  const goBackToList = useCallback(() => {
    navigateWithSearch((previous) => ({
      ...previous,
      history: "1" as const,
      historyCommit: undefined,
    }));
  }, [navigateWithSearch]);

  const closePanel = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      navigateWithSearch((previous) => ({
        ...stripHistorySearchParams(previous),
        diff: undefined,
        history: undefined,
      }));
    }
  }, [onClose, navigateWithSearch]);

  const askAboutCommit = useCallback(
    (commit: { hash: string; abbreviatedHash: string; subject: string }) => {
      const projectId = activeThread?.projectId ?? routeProjectId;
      if (!projectId) return;

      const threadId = newThreadId();
      const { setProjectDraftThreadId, setPrompt } = useComposerDraftStore.getState();

      setProjectDraftThreadId(projectId, threadId, {
        createdAt: new Date().toISOString(),
        branch: null,
        worktreePath: activeThread?.worktreePath ?? null,
        envMode: "local",
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });

      setPrompt(
        threadId,
        `Look up commit ${commit.abbreviatedHash} (\`git show ${commit.hash}\`) — "${commit.subject}"\n\n`,
      );

      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [activeThread?.projectId, activeThread?.worktreePath, navigate, routeProjectId],
  );

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api) return;
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open diff file in editor.", error);
      });
    },
    [activeCwd],
  );

  const renderableFiles = useMemo(
    () =>
      getRenderableFiles(
        commitDiffQuery.data?.patch,
        `history:${selectedCommitHash}:${resolvedTheme}`,
      ),
    [commitDiffQuery.data?.patch, selectedCommitHash, resolvedTheme],
  );

  // ── Code selection / comment system (shared with DiffPanel) ───────
  const {
    editingCommentBody,
    editingCommentError,
    lineAnnotationsByFileKey,
    manualCommentBody,
    manualCommentError,
    selectedLinesForFileKey,
    visiblePendingDiffContextComments,
    beginEditingComment,
    cancelEditingComment,
    clearManualCommentSelection,
    deleteEditingComment,
    handleManualCommentSelectionChange,
    saveEditingComment,
    setEditingCommentBody,
    setManualCommentBody,
    submitManualComment,
  } = useDiffContextCommentDrafts({
    activeThreadId: routeThreadId,
    selectedTurnId: null, // commit diffs have no turn context
    renderableFiles,
  });

  const renderDraftAnnotation = useCallback(
    (annotation: DiffLineAnnotation<DiffCommentAnnotationMetadata>) => {
      const { metadata } = annotation;
      if (metadata.kind === "draft-comment") {
        return (
          <DiffContextCommentDraftCard
            filePath={metadata.filePath}
            lineStart={metadata.lineStart}
            lineEnd={metadata.lineEnd}
            body={manualCommentBody}
            error={manualCommentError}
            onBodyChange={setManualCommentBody}
            onCancel={clearManualCommentSelection}
            onSubmit={submitManualComment}
          />
        );
      }

      const comment = visiblePendingDiffContextComments.find(
        (entry: { id: string }) => entry.id === metadata.commentId,
      );
      if (!comment) return null;

      if (metadata.isEditing) {
        return (
          <DiffContextCommentDraftCard
            filePath={comment.filePath}
            lineStart={comment.lineStart}
            lineEnd={comment.lineEnd}
            body={editingCommentBody}
            error={editingCommentError}
            onBodyChange={setEditingCommentBody}
            onCancel={cancelEditingComment}
            onDelete={deleteEditingComment}
            onSubmit={saveEditingComment}
            submitLabel="Save"
          />
        );
      }

      return (
        <DiffContextCommentPreview
          body={comment.body}
          onEdit={() => beginEditingComment(comment)}
        />
      );
    },
    [
      beginEditingComment,
      cancelEditingComment,
      clearManualCommentSelection,
      deleteEditingComment,
      editingCommentBody,
      editingCommentError,
      manualCommentBody,
      manualCommentError,
      saveEditingComment,
      setEditingCommentBody,
      setManualCommentBody,
      submitManualComment,
      visiblePendingDiffContextComments,
    ],
  );

  // Header
  const headerContent = selectedCommitHash ? (
    <div className="flex w-full items-center gap-2 px-1">
      <button
        type="button"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground [-webkit-app-region:no-drag]"
        aria-label="Back to commit list"
        onClick={goBackToList}
      >
        <ArrowLeftIcon className="size-3.5" />
      </button>
      <div className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {commitDiffQuery.data?.commit.abbreviatedHash ?? selectedCommitHash.slice(0, 7)}
          </span>
          <span className="min-w-0 truncate text-xs font-medium text-foreground">
            {commitDiffQuery.data?.commit.subject ?? "Loading..."}
          </span>
        </div>
        {commitDiffQuery.data?.commit && (
          <div className="mt-0.5 text-[10px] text-muted-foreground/70">
            {commitDiffQuery.data.commit.authorName} &middot;{" "}
            {formatRelativeDate(commitDiffQuery.data.commit.authorDate)}
          </div>
        )}
      </div>
      {commitDiffQuery.data?.commit && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground [-webkit-app-region:no-drag]"
                aria-label="Ask about this commit"
                onClick={() => askAboutCommit(commitDiffQuery.data!.commit)}
              >
                <MessageSquareIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="bottom">Ask about this commit</TooltipPopup>
        </Tooltip>
      )}
      <button
        type="button"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground [-webkit-app-region:no-drag]"
        aria-label="Close history panel"
        onClick={closePanel}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  ) : (
    <div className="flex w-full items-center gap-2 px-1">
      <div className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">Git History</span>
          {currentBranch && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {currentBranch}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground [-webkit-app-region:no-drag]"
        aria-label="Close history panel"
        onClick={closePanel}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );

  const commitBody = commitDiffQuery.data?.body ?? "";

  return (
    <DiffPanelShell mode={mode} header={headerContent}>
      {selectedCommitHash ? (
        // Commit diff view
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {commitDiffQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground/70">
              Loading commit diff...
            </div>
          ) : commitDiffQuery.error ? (
            <div className="flex h-full items-center justify-center px-3 text-xs text-red-500/80">
              Failed to load commit diff.
            </div>
          ) : renderableFiles.length === 0 && !commitBody ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground/70">
              No changes in this commit.
            </div>
          ) : (
            <Virtualizer
              className="h-full min-h-0 overflow-auto px-2 pb-2"
              config={{
                overscrollSize: 600,
                intersectionObserverMargin: 1200,
              }}
            >
              {commitBody && (
                <div className="mt-2 mb-2 rounded-md border border-border bg-background/50 px-3 py-2">
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                    {commitBody}
                  </p>
                </div>
              )}
              {renderableFiles.map((fileDiff) => {
                const filePath = resolveFileDiffPath(fileDiff);
                const fileKey = buildFileDiffRenderKey(fileDiff);
                const themedFileKey = `history:${selectedCommitHash}:${filePath}:${resolvedTheme}`;
                return (
                  <div
                    key={themedFileKey}
                    data-diff-file-path={filePath}
                    className="mb-2 rounded-md first:mt-2 last:mb-0"
                    onClickCapture={(event) => {
                      const nativeEvent = event.nativeEvent as MouseEvent;
                      const composedPath = nativeEvent.composedPath?.() ?? [];
                      const clickedHeader = composedPath.some((node) => {
                        if (!(node instanceof Element)) return false;
                        return node.hasAttribute("data-title");
                      });
                      if (!clickedHeader) return;
                      openDiffFileInEditor(filePath);
                    }}
                  >
                    <FileDiff
                      fileDiff={fileDiff}
                      lineAnnotations={lineAnnotationsByFileKey[fileKey] ?? []}
                      selectedLines={
                        selectedLinesForFileKey?.fileKey === fileKey
                          ? selectedLinesForFileKey.range
                          : null
                      }
                      renderAnnotation={renderDraftAnnotation}
                      options={{
                        diffStyle: "unified",
                        lineDiffType: "none",
                        enableGutterUtility: true,
                        enableLineSelection: true,
                        onGutterUtilityClick: (range) =>
                          handleManualCommentSelectionChange({
                            file: fileDiff,
                            fileKey,
                            range,
                          }),
                        onLineSelected: (range) =>
                          handleManualCommentSelectionChange({
                            file: fileDiff,
                            fileKey,
                            range,
                          }),
                        theme: resolveDiffThemeName(resolvedTheme),
                        themeType: resolvedTheme as "light" | "dark",
                        unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                      }}
                    />
                  </div>
                );
              })}
            </Virtualizer>
          )}
        </div>
      ) : (
        // Commit list view
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Search bar */}
          <div className="shrink-0 border-b border-border/50 px-3 py-2 space-y-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search commits..."
                className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-8 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                spellCheck={false}
              />
              <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {searchInput && (
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/40 hover:text-foreground"
                    onClick={() => {
                      setSearchInput("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    "rounded p-0.5 transition-colors",
                    showDateFilter || sinceDate || untilDate
                      ? "text-primary"
                      : "text-muted-foreground/40 hover:text-foreground",
                  )}
                  onClick={() => setShowDateFilter((v) => !v)}
                  title="Filter by date"
                >
                  <CalendarIcon className="size-3" />
                </button>
              </div>
            </div>
            {showDateFilter && (
              <div className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground/70">From</span>
                  <input
                    type="date"
                    value={sinceDate}
                    onChange={(e) => setSinceDate(e.target.value)}
                    className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
                <label className="flex flex-1 items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground/70">To</span>
                  <input
                    type="date"
                    value={untilDate}
                    onChange={(e) => setUntilDate(e.target.value)}
                    className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
                {(sinceDate || untilDate) && (
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground/40 hover:text-foreground"
                    onClick={() => {
                      setSinceDate("");
                      setUntilDate("");
                    }}
                    title="Clear dates"
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Commit list */}
          <div className="min-h-0 flex-1 overflow-auto">
            {allCommits.length === 0 && !isLoadingMore ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground/70">
                {debouncedSearch || sinceDate || untilDate
                  ? "No matching commits."
                  : "No commits found."}
              </div>
            ) : (
              <div className="flex flex-col">
                {allCommits.map((commit) => (
                  <div
                    key={commit.hash}
                    className={cn(
                      "group flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left transition-colors",
                      "hover:bg-accent/50",
                    )}
                  >
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => selectCommit(commit.hash)}
                    >
                      {commit.abbreviatedHash}
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => selectCommit(commit.hash)}
                    >
                      <div className="truncate text-xs font-medium text-foreground">
                        {commit.subject}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                        {commit.authorName} &middot; {formatRelativeDate(commit.authorDate)}
                      </div>
                    </button>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100"
                            aria-label="Ask about this commit"
                            onClick={(event) => {
                              event.stopPropagation();
                              askAboutCommit(commit);
                            }}
                          >
                            <MessageSquareIcon className="size-3" />
                          </button>
                        }
                      />
                      <TooltipPopup side="left">Ask about this commit</TooltipPopup>
                    </Tooltip>
                  </div>
                ))}
                {hasMore && (
                  <button
                    type="button"
                    className="w-full px-3 py-3 text-center text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
                    onClick={() => setSkipOffset((prev) => prev + LOG_PAGE_SIZE)}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? "Loading..." : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}

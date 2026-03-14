import type { GitStackedAction, GitStatusResult } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation, useIsMutating } from "@tanstack/react-query";
import { LoaderIcon, SparklesIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import {
  gitBranchesQueryOptions,
  gitRunStackedActionMutationOptions,
  gitMutationKeys,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "~/lib/gitReactQuery";
import { buildGitActionProgressStages, summarizeGitResult } from "./GitActionsControl.logic";
import { openInPreferredEditor } from "~/editorPreferences";
import { resolvePathLinkTarget } from "~/terminal-links";
import { readNativeApi, ensureNativeApi } from "~/nativeApi";
import { useAppSettings } from "~/appSettings";

interface CommitDialogProps {
  cwd: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default action when clicking the primary button. */
  defaultAction?: GitStackedAction;
}

export function CommitDialog({
  cwd,
  open,
  onOpenChange,
  defaultAction = "commit_push",
}: CommitDialogProps) {
  const { settings: appSettings } = useAppSettings();
  const queryClient = useQueryClient();
  const [commitMessage, setCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: gitStatus = null } = useQuery(gitStatusQueryOptions(cwd));
  const { data: branchList = null } = useQuery(gitBranchesQueryOptions(cwd));

  const hasOriginRemote = branchList?.hasOriginRemote ?? false;
  const isDefaultBranch = useMemo(() => {
    const branchName = gitStatus?.branch;
    if (!branchName) return false;
    const current = branchList?.branches.find((b) => b.name === branchName);
    return current?.isDefault ?? (branchName === "main" || branchName === "master");
  }, [branchList?.branches, gitStatus?.branch]);

  const allFiles = gitStatus?.workingTree.files ?? [];
  const selectedFiles = allFiles.filter((f) => !excludedFiles.has(f.path));
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const runMutation = useMutation(
    gitRunStackedActionMutationOptions({ cwd, queryClient }),
  );
  const isRunning = useIsMutating({ mutationKey: gitMutationKeys.runStackedAction(cwd) }) > 0;

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setCommitMessage("");
      setExcludedFiles(new Set());
      setIsEditingFiles(false);
    }
  }, [open]);

  const generateMessage = useCallback(async () => {
    setIsGenerating(true);
    try {
      const api = ensureNativeApi();
      const filePaths = !allSelected ? selectedFiles.map((f) => f.path) : undefined;
      const result = await api.git.generateCommitMessage({
        cwd,
        ...(filePaths ? { filePaths } : {}),
        ...(appSettings.commitMessageInstructions
          ? { commitMessageInstructions: appSettings.commitMessageInstructions }
          : {}),
      });
      const msg = result.body
        ? `${result.subject}\n\n${result.body}`
        : result.subject;
      setCommitMessage(msg);
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Failed to generate commit message",
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [cwd, allSelected, selectedFiles, appSettings.commitMessageInstructions]);

  const runAction = useCallback(
    async (action: GitStackedAction, featureBranch = false) => {
      let msg = commitMessage.trim();
      onOpenChange(false);

      // Auto-generate commit message if empty
      if (!msg) {
        const genToastId = toastManager.add({
          type: "loading",
          title: "Generating commit message...",
          timeout: 0,
        });
        try {
          const api = ensureNativeApi();
          const filePaths = !allSelected ? selectedFiles.map((f) => f.path) : undefined;
          const result = await api.git.generateCommitMessage({
            cwd,
            ...(filePaths ? { filePaths } : {}),
            ...(appSettings.commitMessageInstructions
              ? { commitMessageInstructions: appSettings.commitMessageInstructions }
              : {}),
          });
          msg = result.body ? `${result.subject}\n\n${result.body}` : result.subject;
          toastManager.close(genToastId);
        } catch {
          toastManager.close(genToastId);
          // Fall through with empty message — server will use a default
        }
      }

      const progressStages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: !!msg,
        hasWorkingTreeChanges: !!gitStatus?.hasWorkingTreeChanges,
        forcePushOnly: false,
        featureBranch,
      });

      const toastId = toastManager.add({
        type: "loading",
        title: progressStages[0] ?? "Running git action...",
        timeout: 0,
      });

      let stageIndex = 0;
      const stageInterval = setInterval(() => {
        stageIndex = Math.min(stageIndex + 1, progressStages.length - 1);
        toastManager.update(toastId, {
          title: progressStages[stageIndex] ?? "Running git action...",
          type: "loading",
          timeout: 0,
        });
      }, 1100);

      try {
        const result = await runMutation.mutateAsync({
          action,
          ...(msg ? { commitMessage: msg } : {}),
          ...(appSettings.commitMessageInstructions
            ? { commitMessageInstructions: appSettings.commitMessageInstructions }
            : {}),
          ...(featureBranch ? { featureBranch } : {}),
          ...(!allSelected ? { filePaths: selectedFiles.map((f) => f.path) } : {}),
        });

        clearInterval(stageInterval);

        const nothingDone =
          result.commit.status === "skipped_no_changes" &&
          result.push.status === "skipped_up_to_date";

        if (nothingDone) {
          toastManager.update(toastId, {
            type: "info",
            title: "Already up to date",
            description: "No uncommitted changes and no unpushed commits.",
          });
        } else {
          const summary = summarizeGitResult(result);
          toastManager.update(toastId, {
            type: "success",
            title: summary.title,
            description: summary.description,
          });
        }

        await invalidateGitQueries(queryClient);
      } catch (err) {
        clearInterval(stageInterval);
        toastManager.update(toastId, {
          type: "error",
          title: "Action failed",
          description: err instanceof Error ? err.message : "An error occurred.",
        });
      }
    },
    [commitMessage, cwd, gitStatus, allSelected, selectedFiles, runMutation, queryClient, onOpenChange, appSettings.commitMessageInstructions],
  );

  const openFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api || !cwd) return;
      const target = resolvePathLinkTarget(filePath, cwd);
      void openInPreferredEditor(api, target).catch(() => {});
    },
    [cwd],
  );

  const primaryLabel =
    defaultAction === "commit_push"
      ? "Commit & Push"
      : defaultAction === "commit_push_pr"
        ? "Commit, Push & PR"
        : defaultAction === "push"
          ? "Push"
          : "Commit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            Review files, generate or write a commit message, then commit.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {/* Branch & status */}
          <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">Branch</span>
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {gitStatus?.branch ?? "(detached HEAD)"}
                </span>
                {isDefaultBranch && (
                  <span className="text-right text-warning text-xs">Warning: default branch</span>
                )}
              </span>
            </div>

            {/* File list */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isEditingFiles && allFiles.length > 0 && (
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && !noneSelected}
                      onCheckedChange={() => {
                        setExcludedFiles(
                          allSelected ? new Set(allFiles.map((f) => f.path)) : new Set(),
                        );
                      }}
                    />
                  )}
                  <span className="text-muted-foreground">Files</span>
                  {!allSelected && !isEditingFiles && (
                    <span className="text-muted-foreground">
                      ({selectedFiles.length} of {allFiles.length})
                    </span>
                  )}
                </div>
                {allFiles.length > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setIsEditingFiles((prev) => !prev)}
                  >
                    {isEditingFiles ? "Done" : "Edit"}
                  </Button>
                )}
              </div>
              {allFiles.length === 0 ? (
                <p className="font-medium text-muted-foreground/60">No changed files</p>
              ) : (
                <div className="space-y-2">
                  <ScrollArea className="h-44 rounded-md border border-input bg-background">
                    <div className="space-y-1 p-1">
                      {allFiles.map((file) => {
                        const isExcluded = excludedFiles.has(file.path);
                        return (
                          <div
                            key={file.path}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50"
                          >
                            {isEditingFiles && (
                              <Checkbox
                                checked={!isExcluded}
                                onCheckedChange={() => {
                                  setExcludedFiles((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(file.path)) {
                                      next.delete(file.path);
                                    } else {
                                      next.add(file.path);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            )}
                            <button
                              type="button"
                              className="flex flex-1 items-center justify-between gap-3 text-left truncate"
                              onClick={() => openFileInEditor(file.path)}
                            >
                              <span
                                className={`truncate${isExcluded ? " text-muted-foreground" : ""}`}
                              >
                                {file.path}
                              </span>
                              <span className="shrink-0">
                                {isExcluded ? (
                                  <span className="text-muted-foreground">Excluded</span>
                                ) : (
                                  <>
                                    <span className="text-success">+{file.insertions}</span>
                                    <span className="text-muted-foreground"> / </span>
                                    <span className="text-destructive">-{file.deletions}</span>
                                  </>
                                )}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <div className="flex justify-end font-mono">
                    <span className="text-success">
                      +{selectedFiles.reduce((sum, f) => sum + f.insertions, 0)}
                    </span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-destructive">
                      -{selectedFiles.reduce((sum, f) => sum + f.deletions, 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Commit message */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Commit message</p>
              <Button
                variant="ghost"
                size="xs"
                disabled={isGenerating || noneSelected}
                onClick={() => void generateMessage()}
              >
                {isGenerating ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <SparklesIcon className="size-3" />
                )}
                <span className="ml-1">{isGenerating ? "Generating..." : "Generate"}</span>
              </Button>
            </div>
            <Textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Leave empty to auto-generate on commit"
              size="sm"
              rows={3}
            />
          </div>
        </DialogPanel>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isDefaultBranch && (
            <Button
              variant="outline"
              size="sm"
              disabled={noneSelected || isRunning}
              onClick={() => void runAction("commit", true)}
            >
              Commit on new branch
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={noneSelected || isRunning}
            onClick={() => void runAction("commit")}
          >
            Commit only
          </Button>
          {hasOriginRemote && (
            <Button
              size="sm"
              disabled={noneSelected || isRunning}
              onClick={() => void runAction(defaultAction)}
            >
              {primaryLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

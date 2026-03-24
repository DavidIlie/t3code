import type { GitStackedAction } from "@t3tools/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  buildGitActionProgressStages,
  summarizeGitResult,
} from "../components/GitActionsControl.logic";
import { toastManager } from "../components/ui/toast";
import { ensureNativeApi } from "../nativeApi";
import { invalidateGitQueries } from "./gitReactQuery";

/**
 * Runs a git stacked action (commit_push, push, etc.) with a live-updating
 * loading toast that cycles through progress stages, then shows the result.
 */
export async function gitPushWithToast(opts: {
  cwd: string;
  action: GitStackedAction;
  queryClient: QueryClient;
  commitMessage?: string;
}) {
  const { cwd, action, queryClient, commitMessage } = opts;

  const progressStages = buildGitActionProgressStages({
    action,
    hasCustomCommitMessage: !!commitMessage?.trim(),
    hasWorkingTreeChanges: true,
    forcePushOnly: false,
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
    const api = ensureNativeApi();
    const result = await api.git.runStackedAction({
      actionId: crypto.randomUUID(),
      cwd,
      action,
      ...(commitMessage ? { commitMessage } : {}),
    });

    clearInterval(stageInterval);

    const nothingDone =
      result.commit.status === "skipped_no_changes" && result.push.status === "skipped_up_to_date";

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
    return result;
  } catch (err) {
    clearInterval(stageInterval);
    toastManager.update(toastId, {
      type: "error",
      title: "Action failed",
      description: err instanceof Error ? err.message : "An error occurred.",
    });
    throw err;
  }
}

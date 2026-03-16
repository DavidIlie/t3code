import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { BugIcon, DiffIcon, HistoryIcon, ZapIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { ProjectFavicon } from "../Sidebar";
import { useProviderSessionStore } from "../../providerSessionStore";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  activeProjectCwd: string | undefined;
  activeProjectId: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  historyOpen: boolean;
  debugPanelOpen: boolean;
  skillsPanelOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleDiff: () => void;
  onToggleHistory: () => void;
  onToggleDebugPanel: () => void;
  onToggleSkillsPanel: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  activeProjectCwd,
  activeProjectId,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  historyOpen,
  debugPanelOpen,
  skillsPanelOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleDiff,
  onToggleHistory,
  onToggleDebugPanel,
  onToggleSkillsPanel,
}: ChatHeaderProps) {
  const sessionInfo = useProviderSessionStore(
    (state) => state.sessionInfoByThread[activeThreadId],
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink truncate gap-1.5">
            {activeProjectCwd && activeProjectId && (
              <ProjectFavicon cwd={activeProjectCwd} projectId={activeProjectId} size="sm" />
            )}
            {activeProjectName}
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
        <SessionInfoBadge sessionInfo={sessionInfo} />
      </div>
      <div className="@container/header-actions flex min-w-0 flex-1 items-center justify-end gap-2 @sm/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={debugPanelOpen}
                onPressedChange={onToggleDebugPanel}
                aria-label="Toggle debug panel"
                variant="outline"
                size="xs"
              >
                <BugIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">Toggle debug panel</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={skillsPanelOpen}
                onPressedChange={onToggleSkillsPanel}
                aria-label="Toggle skills panel"
                variant="outline"
                size="xs"
              >
                <ZapIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">Toggle skills panel</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={historyOpen}
                onPressedChange={onToggleHistory}
                aria-label="Toggle git history panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <HistoryIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "History panel is unavailable because this project is not a git repository."
              : "Toggle git history panel"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});

function formatModelName(model: string): string {
  // "claude-opus-4-6" → "Opus 4.6", "claude-sonnet-4-5-20250929" → "Sonnet 4.5"
  const match = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (match?.[1] && match[2] && match[3]) {
    const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    return `${family} ${match[2]}.${match[3]}`;
  }
  return model;
}

import type { SessionInfo } from "../../providerSessionStore";

function SessionInfoBadge({ sessionInfo }: { sessionInfo: SessionInfo | undefined }) {
  if (!sessionInfo) return null;
  const { providerVersion, model } = sessionInfo;
  if (!providerVersion && !model) return null;

  const parts: string[] = [];
  if (providerVersion) parts.push(`v${providerVersion}`);
  if (model) parts.push(formatModelName(model));

  return (
    <Badge variant="outline" className="hidden shrink-0 gap-1 text-[10px] text-muted-foreground sm:inline-flex">
      {parts.join(" / ")}
    </Badge>
  );
}

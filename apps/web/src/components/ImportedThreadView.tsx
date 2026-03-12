import { useEffect, useMemo, useState } from "react";
import type { ThreadId, ImportedSessionMessage, ImportedContentBlock } from "@t3tools/contracts";
import { BrainIcon, ChevronRightIcon, SendIcon } from "lucide-react";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import ChatMarkdown from "./ChatMarkdown";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "./ui/collapsible";
import ToolCallCard from "./imported/ToolCallCard";
import { deriveConversationTurns, type ConversationTurn } from "./imported/importedSessionUtils";

// ── ThinkingBlock (inline — small enough to not warrant a separate file) ──

function ThinkingBlock({ thinking }: { thinking: string }) {
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="flex items-center gap-2 py-1.5 text-[11px] text-muted-foreground/50">
        <BrainIcon className="size-3.5" />
        <span className="italic">Thinking...</span>
        <ChevronRightIcon className="size-3 transition-transform duration-200 [[data-panel-open]_&]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="border-l-2 border-muted-foreground/15 py-1 pl-3">
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground/40">
            {thinking}
          </pre>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

// ── Block renderer ──────────────────────────────────────────────────

function AssistantBlock({
  block,
  cwd,
}: {
  block: ImportedContentBlock;
  cwd: string | undefined;
}) {
  switch (block.type) {
    case "text":
      return (
        <div className="min-w-0 px-1 py-0.5">
          <ChatMarkdown text={block.text} cwd={cwd} />
        </div>
      );
    case "thinking":
      return <ThinkingBlock thinking={block.thinking} />;
    case "tool_use":
      return <ToolCallCard block={block} />;
    default:
      return null;
  }
}

// ── Turn renderer ───────────────────────────────────────────────────

function TurnView({ turn, cwd }: { turn: ConversationTurn; cwd: string | undefined }) {
  return (
    <div className="space-y-3">
      {turn.userText && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
            <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">
              {turn.userText}
            </pre>
          </div>
        </div>
      )}

      {turn.assistantBlocks.length > 0 && (
        <div className="space-y-2">
          {turn.assistantBlocks.map(({ key, block }) => (
            <AssistantBlock key={key} block={block} cwd={cwd} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

interface ImportedThreadViewProps {
  threadId: ThreadId;
  onResume: () => void;
}

export default function ImportedThreadView({ threadId, onResume }: ImportedThreadViewProps) {
  const [messages, setMessages] = useState<ImportedSessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const thread = useStore((s) => s.threads.find((t) => t.id === threadId));
  const project = useStore((s) => s.projects.find((p) => p.id === thread?.projectId));

  const sessionId = threadId.replace("claude-", "");

  useEffect(() => {
    let cancelled = false;
    const api = readNativeApi();
    if (!api || !project) {
      setLoading(false);
      return;
    }

    api.projects
      .getSessionMessages({
        sessionId,
        workspaceRoot: project.cwd,
      })
      .then((result) => {
        if (cancelled) return;
        setMessages(result as ImportedSessionMessage[]);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load messages");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, project]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/60">Loading session history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  const turns = useMemo(() => deriveConversationTurns(messages), [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {turns.length === 0 && (
            <p className="text-center text-sm text-muted-foreground/60">
              No messages found in this session.
            </p>
          )}
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} cwd={project?.cwd} />
          ))}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={onResume}
          >
            <SendIcon className="size-4" />
            Resume this conversation
          </button>
        </div>
      </div>
    </div>
  );
}

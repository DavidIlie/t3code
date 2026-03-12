import type { ImportedToolUseBlock } from "@t3tools/contracts";
import {
  BotIcon,
  ChevronRightIcon,
  FileTextIcon,
  FilePlusIcon,
  GlobeIcon,
  PencilIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "~/components/ui/collapsible";
import { extractToolResultText, stripAnsi } from "./importedSessionUtils";

function toolIcon(name: string): LucideIcon {
  switch (name) {
    case "Bash":
      return TerminalIcon;
    case "Read":
      return FileTextIcon;
    case "Write":
      return FilePlusIcon;
    case "Edit":
      return PencilIcon;
    case "Glob":
    case "Grep":
      return SearchIcon;
    case "Agent":
      return BotIcon;
    case "WebSearch":
    case "WebFetch":
      return GlobeIcon;
    default:
      return name.startsWith("mcp__") ? PlugIcon : WrenchIcon;
  }
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function formatMcpToolName(name: string): string {
  // mcp__servername__toolname → servername / toolname
  const parts = name.split("__");
  if (parts.length >= 3) return `${parts[1]} / ${parts.slice(2).join("__")}`;
  return name;
}

/** Returns a short description for the header line, or null. */
function toolDescription(block: ImportedToolUseBlock): string | null {
  const input = block.input as Record<string, unknown>;
  switch (block.name) {
    case "Bash":
      return typeof input.description === "string" ? input.description : null;
    case "Read":
      return typeof input.file_path === "string" ? basename(input.file_path) : null;
    case "Write":
      return typeof input.file_path === "string" ? `Created ${basename(input.file_path)}` : null;
    case "Edit":
      return typeof input.file_path === "string" ? basename(input.file_path) : null;
    case "Glob":
    case "Grep": {
      const pattern = (input.pattern ?? input.glob) as string | undefined;
      const path = input.path as string | undefined;
      if (!pattern) return null;
      return path ? `${pattern} in ${path}` : pattern;
    }
    case "Agent":
      return typeof input.description === "string" ? input.description : null;
    case "WebSearch":
      return typeof input.query === "string" ? input.query : null;
    case "WebFetch":
      return typeof input.url === "string" ? input.url : null;
    default:
      return null;
  }
}

const OUTPUT_COLLAPSE_THRESHOLD = 20;
const OUTPUT_PREVIEW_LINES = 10;

function CollapsibleOutput({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsCollapse = lines.length > OUTPUT_COLLAPSE_THRESHOLD;

  if (!needsCollapse) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">
        {text}
      </pre>
    );
  }

  return (
    <div>
      <pre className="max-h-[500px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">
        {expanded ? text : lines.slice(0, OUTPUT_PREVIEW_LINES).join("\n")}
      </pre>
      {!expanded && (
        <button
          type="button"
          className="mt-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80"
          onClick={() => setExpanded(true)}
        >
          Show all {lines.length} lines
        </button>
      )}
    </div>
  );
}

function OutputSection({ result }: { result: { content: unknown; isError: boolean } }) {
  const text = stripAnsi(extractToolResultText(result.content));
  if (!text.trim()) return null;

  return (
    <div
      className={`mt-2 rounded-md border px-2 py-1.5 ${
        result.isError
          ? "border-rose-500/30 bg-rose-950/10"
          : "border-border/70 bg-background/50"
      }`}
    >
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50">
        {result.isError ? "Error" : "Output"}
      </div>
      <CollapsibleOutput text={text} />
    </div>
  );
}

// ── Per-tool body renderers (descriptions are now in the header) ────

function BashBody({ block }: { block: ImportedToolUseBlock }) {
  const input = block.input as { command?: string };
  return (
    <>
      {input.command && (
        <div className="mt-2 rounded-md border border-border/70 bg-background/80 px-2 py-1.5">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
            {input.command}
          </pre>
        </div>
      )}
      {block.result && <OutputSection result={block.result} />}
    </>
  );
}

function ReadBody({ block }: { block: ImportedToolUseBlock }) {
  const input = block.input as { file_path?: string };
  return (
    <>
      {input.file_path && (
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/40">
          {input.file_path}
        </div>
      )}
      {block.result && (
        <Collapsible defaultOpen={false} className="mt-2">
          <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80">
            <ChevronRightIcon className="size-3 transition-transform duration-200 [[data-panel-open]_&]:rotate-90" />
            File contents
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <OutputSection result={block.result} />
          </CollapsiblePanel>
        </Collapsible>
      )}
    </>
  );
}

function WriteBody({ block }: { block: ImportedToolUseBlock }) {
  const input = block.input as { content?: string };
  return (
    <>
      {input.content && (
        <Collapsible defaultOpen={false} className="mt-2">
          <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80">
            <ChevronRightIcon className="size-3 transition-transform duration-200 [[data-panel-open]_&]:rotate-90" />
            File content
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-1 rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
              <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">
                {input.content}
              </pre>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
      {block.result?.isError && block.result && <OutputSection result={block.result} />}
    </>
  );
}

function EditBody({ block }: { block: ImportedToolUseBlock }) {
  const input = block.input as {
    old_string?: string;
    new_string?: string;
  };
  const hasOld = input.old_string != null && input.old_string !== "";
  const hasNew = input.new_string != null;
  return (
    <>
      {(hasOld || hasNew) && (
        <div className="mt-2 overflow-hidden rounded-md border border-border/70 font-mono text-[11px]">
          {hasOld && (
            <div className="bg-rose-500/8 px-2 py-1 text-rose-400/70">
              <pre className="whitespace-pre-wrap break-words line-through decoration-rose-400/30">
                {input.old_string}
              </pre>
            </div>
          )}
          {hasNew && (
            <div className="bg-emerald-500/8 px-2 py-1 text-emerald-400/70">
              <pre className="whitespace-pre-wrap break-words">{input.new_string}</pre>
            </div>
          )}
        </div>
      )}
      {block.result?.isError && block.result && <OutputSection result={block.result} />}
    </>
  );
}

function AgentBody({ block }: { block: ImportedToolUseBlock }) {
  const input = block.input as { prompt?: string };
  return (
    <>
      {input.prompt && (
        <Collapsible defaultOpen={false} className="mt-2">
          <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80">
            <ChevronRightIcon className="size-3 transition-transform duration-200 [[data-panel-open]_&]:rotate-90" />
            Prompt
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-1 rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
              <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">
                {input.prompt}
              </pre>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
      {block.result && <OutputSection result={block.result} />}
    </>
  );
}

function GenericBody({ block }: { block: ImportedToolUseBlock }) {
  const hasInput = Object.keys(block.input).length > 0;
  return (
    <>
      {hasInput && (
        <Collapsible defaultOpen={false} className="mt-2">
          <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80">
            <ChevronRightIcon className="size-3 transition-transform duration-200 [[data-panel-open]_&]:rotate-90" />
            Input
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-1 rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
              <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/70">
                {JSON.stringify(block.input, null, 2)}
              </pre>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      )}
      {block.result && <OutputSection result={block.result} />}
    </>
  );
}

function ToolBody({ block }: { block: ImportedToolUseBlock }) {
  switch (block.name) {
    case "Bash":
      return <BashBody block={block} />;
    case "Read":
      return <ReadBody block={block} />;
    case "Write":
      return <WriteBody block={block} />;
    case "Edit":
      return <EditBody block={block} />;
    case "Glob":
    case "Grep":
      return block.result ? <OutputSection result={block.result} /> : null;
    case "Agent":
      return <AgentBody block={block} />;
    case "WebSearch":
    case "WebFetch":
      return block.result ? <OutputSection result={block.result} /> : null;
    default:
      return <GenericBody block={block} />;
  }
}

// ── Main ToolCallCard ───────────────────────────────────────────────

export default function ToolCallCard({ block }: { block: ImportedToolUseBlock }) {
  const Icon = toolIcon(block.name);
  const displayName =
    block.name.startsWith("mcp__") ? formatMcpToolName(block.name) : block.name;
  const description = toolDescription(block);

  const isError = block.result?.isError ?? false;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        isError
          ? "border-rose-500/30 bg-rose-950/10"
          : "border-border/60 bg-card/30"
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/70">
        <Icon className="size-3.5 shrink-0" />
        <span>{displayName}</span>
        {description && (
          <span className="truncate font-normal text-muted-foreground/50">· {description}</span>
        )}
      </div>

      <ToolBody block={block} />
    </div>
  );
}

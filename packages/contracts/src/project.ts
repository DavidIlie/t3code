import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH),
  ),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

// ── Claude Code Session Import ─────────────────────────────────────

export const ProjectImportHistoryInput = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
});
export type ProjectImportHistoryInput = typeof ProjectImportHistoryInput.Type;

export const ClaudeSessionInfo = Schema.Struct({
  sessionId: Schema.String,
  summary: Schema.String,
  lastModified: Schema.Number,
  fileSize: Schema.Number,
});
export type ClaudeSessionInfo = typeof ClaudeSessionInfo.Type;

export const ProjectImportHistoryResult = Schema.Struct({
  sessions: Schema.Array(ClaudeSessionInfo),
});
export type ProjectImportHistoryResult = typeof ProjectImportHistoryResult.Type;

export const ProjectGetSessionMessagesInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  limit: Schema.optional(PositiveInt),
});
export type ProjectGetSessionMessagesInput = typeof ProjectGetSessionMessagesInput.Type;

// ── Imported Session Content Blocks ────────────────────────────────
export interface ImportedTextBlock {
  type: "text";
  text: string;
}
export interface ImportedThinkingBlock {
  type: "thinking";
  thinking: string;
}
export interface ImportedToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: { content: unknown; isError: boolean };
}
export interface ImportedToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: unknown;
  isError: boolean;
}
export type ImportedContentBlock =
  | ImportedTextBlock
  | ImportedThinkingBlock
  | ImportedToolUseBlock
  | ImportedToolResultBlock;

export interface ImportedSessionMessage {
  type: "user" | "assistant";
  uuid: string;
  sessionId: string;
  blocks: ImportedContentBlock[];
}

// ── Per-project MCP Server Config ──────────────────────────────────

export const ProjectGetMcpServersInput = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
});
export type ProjectGetMcpServersInput = typeof ProjectGetMcpServersInput.Type;

const McpServerScope = Schema.Literals(["global", "project"]);

export const ProjectAddMcpServerInput = Schema.Struct({
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  scope: McpServerScope,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  type: Schema.Literals(["stdio", "sse", "http"]),
  command: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  args: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(512)))),
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
});
export type ProjectAddMcpServerInput = typeof ProjectAddMcpServerInput.Type;

export const ProjectRemoveMcpServerInput = Schema.Struct({
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  scope: McpServerScope,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type ProjectRemoveMcpServerInput = typeof ProjectRemoveMcpServerInput.Type;

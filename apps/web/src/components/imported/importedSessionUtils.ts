import type { ImportedContentBlock, ImportedSessionMessage } from "@t3tools/contracts";

export interface KeyedBlock {
  key: string;
  block: ImportedContentBlock;
}

export interface ConversationTurn {
  id: string;
  userText: string | null;
  assistantBlocks: KeyedBlock[];
}

/**
 * Groups imported session messages into conversation turns.
 * Each turn is a user prompt followed by all assistant blocks until the next user message.
 */
export function deriveConversationTurns(messages: ImportedSessionMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let blockCounter = 0;

  for (const msg of messages) {
    if (msg.type === "user") {
      if (currentTurn) turns.push(currentTurn);
      const userText = msg.blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      currentTurn = {
        id: msg.uuid,
        userText: userText || null,
        assistantBlocks: [],
      };
    } else if (msg.type === "assistant") {
      if (!currentTurn) {
        currentTurn = { id: msg.uuid, userText: null, assistantBlocks: [] };
      }
      for (const block of msg.blocks) {
        const key = block.type === "tool_use" ? block.id : `b-${blockCounter++}`;
        currentTurn.assistantBlocks.push({ key, block });
      }
    }
  }
  if (currentTurn) turns.push(currentTurn);

  return turns;
}

/**
 * Extracts plain text from tool_result content, which can be a string,
 * an array of text blocks, or other structures.
 */
export function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Strips ANSI escape codes from text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

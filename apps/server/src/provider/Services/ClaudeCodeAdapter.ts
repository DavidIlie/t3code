/**
 * ClaudeCodeAdapter - Claude Code implementation of the generic provider adapter contract.
 *
 * This service owns Claude runtime/session semantics and emits canonical
 * provider runtime events. It does not perform cross-provider routing, shared
 * event fan-out, or checkpoint orchestration.
 *
 * Uses Effect `ServiceMap.Service` for dependency injection and returns the
 * shared provider-adapter error channel with `provider: "claudeAgent"` context.
 *
 * @module ClaudeCodeAdapter
 */
import type { ThreadId } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * ClaudeCodeAdapterShape - Service API for the Claude Code provider adapter.
 */
export interface ClaudeCodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "claudeAgent";

  /**
   * Reconnect a disconnected MCP server for an active session.
   */
  readonly reconnectMcpServer: (
    threadId: ThreadId,
    serverName: string,
  ) => Effect.Effect<void, ProviderAdapterError>;

  /**
   * Toggle an MCP server on/off for an active session.
   */
  readonly toggleMcpServer: (
    threadId: ThreadId,
    serverName: string,
    enabled: boolean,
  ) => Effect.Effect<void, ProviderAdapterError>;
}

/**
 * ClaudeCodeAdapter - Service tag for Claude Code provider adapter operations.
 */
export class ClaudeCodeAdapter extends ServiceMap.Service<
  ClaudeCodeAdapter,
  ClaudeCodeAdapterShape
>()("t3/provider/Services/ClaudeCodeAdapter") {}

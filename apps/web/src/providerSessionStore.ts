import { create } from "zustand";
import type { ProviderKind } from "@t3tools/contracts";

export interface SlashCommandInfo {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string | undefined;
}

export interface McpServerInfo {
  readonly name: string;
  readonly status: string;
  readonly tools?: ReadonlyArray<{ readonly name: string; readonly description?: string | undefined }> | undefined;
}

export interface AccountInfo {
  [key: string]: unknown;
}

export interface SessionInfo {
  readonly providerVersion: string | undefined;
  readonly model: string | undefined;
}

export interface UsageTier {
  label: string;
  percentUsed: number;
  resetAt: string | null;
  status: "ok" | "warning" | "critical";
}

export interface ProviderUsageSnapshot {
  provider: ProviderKind;
  plan: string | null;
  tiers: UsageTier[];
  extraUsage: { spent: number; limit: number } | null;
  updatedAt: string;
  raw: unknown;
}

interface ProviderSessionState {
  /** Commands (skills) per thread, keyed by threadId */
  commandsByThread: Record<string, ReadonlyArray<SlashCommandInfo>>;
  /** MCP server status per thread */
  mcpStatusByThread: Record<string, ReadonlyArray<McpServerInfo>>;
  /** Account info per thread */
  accountByThread: Record<string, AccountInfo>;
  /** Global MCP servers from ~/.claude/mcp.json (pre-session) */
  globalMcpServers: McpServerInfo[];
  /** Usage snapshots per provider */
  usageByProvider: Partial<Record<ProviderKind, ProviderUsageSnapshot>>;
  /** Session info (version, model) per thread */
  sessionInfoByThread: Record<string, SessionInfo>;

  setCommands: (threadId: string, commands: ReadonlyArray<SlashCommandInfo>) => void;
  setMcpStatus: (threadId: string, status: ReadonlyArray<McpServerInfo>) => void;
  setAccountInfo: (threadId: string, account: AccountInfo) => void;
  setGlobalMcpServers: (servers: McpServerInfo[]) => void;
  setProviderUsage: (provider: ProviderKind, snapshot: ProviderUsageSnapshot) => void;
  setSessionInfo: (threadId: string, info: SessionInfo) => void;
}

export const useProviderSessionStore = create<ProviderSessionState>((set) => ({
  commandsByThread: {},
  mcpStatusByThread: {},
  accountByThread: {},
  globalMcpServers: [],
  usageByProvider: {},
  sessionInfoByThread: {},

  setCommands: (threadId, commands) =>
    set((state) => ({
      commandsByThread: { ...state.commandsByThread, [threadId]: commands },
    })),
  setMcpStatus: (threadId, status) =>
    set((state) => ({
      mcpStatusByThread: { ...state.mcpStatusByThread, [threadId]: status },
    })),
  setAccountInfo: (threadId, account) =>
    set((state) => ({
      accountByThread: { ...state.accountByThread, [threadId]: account },
    })),
  setGlobalMcpServers: (servers) => set({ globalMcpServers: servers }),
  setProviderUsage: (provider, snapshot) =>
    set((state) => ({
      usageByProvider: { ...state.usageByProvider, [provider]: snapshot },
    })),
  setSessionInfo: (threadId, info) =>
    set((state) => ({
      sessionInfoByThread: { ...state.sessionInfoByThread, [threadId]: info },
    })),
}));

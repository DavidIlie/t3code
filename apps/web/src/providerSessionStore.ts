import { create } from "zustand";
import type { ProviderKind } from "@t3tools/contracts";

export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint: string;
}

export interface McpServerInfo {
  name: string;
  status: string;
  tools?: Array<{ name: string; description?: string }>;
}

export interface AccountInfo {
  [key: string]: unknown;
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
  commandsByThread: Record<string, SlashCommandInfo[]>;
  /** MCP server status per thread */
  mcpStatusByThread: Record<string, McpServerInfo[]>;
  /** Account info per thread */
  accountByThread: Record<string, AccountInfo>;
  /** Global MCP servers from ~/.claude/mcp.json (pre-session) */
  globalMcpServers: McpServerInfo[];
  /** Usage snapshots per provider */
  usageByProvider: Partial<Record<ProviderKind, ProviderUsageSnapshot>>;

  setCommands: (threadId: string, commands: SlashCommandInfo[]) => void;
  setMcpStatus: (threadId: string, status: McpServerInfo[]) => void;
  setAccountInfo: (threadId: string, account: AccountInfo) => void;
  setGlobalMcpServers: (servers: McpServerInfo[]) => void;
  setProviderUsage: (provider: ProviderKind, snapshot: ProviderUsageSnapshot) => void;
}

export const useProviderSessionStore = create<ProviderSessionState>((set) => ({
  commandsByThread: {},
  mcpStatusByThread: {},
  accountByThread: {},
  globalMcpServers: [],
  usageByProvider: {},

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
}));

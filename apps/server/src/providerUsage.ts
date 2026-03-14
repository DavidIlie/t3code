/**
 * Provider usage fetcher.
 *
 * Reads credentials from local provider config files and fetches
 * usage/rate-limit data from the Claude and Codex APIs.
 *
 * On macOS, Claude Code stores OAuth tokens in the Keychain under
 * "Claude Code-credentials". On Linux it falls back to the file at
 * ~/.claude/.credentials.json.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ProviderUsageResult, ProviderUsageTier } from "@t3tools/contracts";

const CLAUDE_CREDENTIALS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");
const CLAUDE_USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_TOKEN_REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const KEYCHAIN_SERVICE_NAME = "Claude Code-credentials";

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string | number;
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

async function readKeychainCredentials(): Promise<ClaudeCredentials | null> {
  if (process.platform !== "darwin") return null;
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE_NAME, "-w"],
      { timeout: 5_000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as ClaudeCredentials);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

async function readFileCredentials(): Promise<ClaudeCredentials | null> {
  try {
    const raw = await fs.readFile(CLAUDE_CREDENTIALS_PATH, "utf-8");
    return JSON.parse(raw) as ClaudeCredentials;
  } catch {
    return null;
  }
}

async function readClaudeCredentials(): Promise<ClaudeCredentials | null> {
  // macOS: prefer Keychain, fall back to file
  const keychain = await readKeychainCredentials();
  if (keychain?.claudeAiOauth?.accessToken) return keychain;
  return readFileCredentials();
}

async function refreshClaudeToken(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch(CLAUDE_TOKEN_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

const TIER_LABEL_MAP: Record<string, string> = {
  five_hour: "Session (5h)",
  seven_day: "Weekly",
  seven_day_sonnet: "Sonnet",
  seven_day_opus: "Opus",
  seven_day_haiku: "Haiku",
  seven_day_cowork: "Cowork",
  seven_day_oauth_apps: "OAuth Apps",
};

async function fetchClaudeUsage(): Promise<ProviderUsageResult["claudeCode"]> {
  const credentials = await readClaudeCredentials();
  if (!credentials?.claudeAiOauth?.accessToken) {
    return { available: false, plan: null, tiers: [], extraUsage: null, error: null };
  }

  let accessToken = credentials.claudeAiOauth.accessToken;

  // Check if token is expired and needs refresh
  if (credentials.claudeAiOauth.expiresAt) {
    const expiresAt =
      typeof credentials.claudeAiOauth.expiresAt === "number"
        ? credentials.claudeAiOauth.expiresAt
        : new Date(credentials.claudeAiOauth.expiresAt).getTime();
    if (Date.now() > expiresAt - 60_000 && credentials.claudeAiOauth.refreshToken) {
      const newToken = await refreshClaudeToken(credentials.claudeAiOauth.refreshToken);
      if (newToken) {
        accessToken = newToken;
      }
    }
  }

  try {
    const response = await fetch(CLAUDE_USAGE_API, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "t3code/0.1.0",
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          available: false,
          plan: null,
          tiers: [],
          extraUsage: null,
          error: "Authentication failed. Re-authenticate Claude Code.",
        };
      }
      return {
        available: true,
        plan: credentials.claudeAiOauth.subscriptionType ?? null,
        tiers: [],
        extraUsage: null,
        error: `API returned ${response.status}`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const tiers: ProviderUsageTier[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (key === "extra_usage") continue;
      if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        if (typeof v.utilization === "number") {
          tiers.push({
            key,
            label: TIER_LABEL_MAP[key] ?? key,
            utilization: v.utilization,
            resetsAt: typeof v.resets_at === "string" ? v.resets_at : null,
          });
        }
      }
    }

    // Parse extra usage
    let extraUsage: ProviderUsageResult["claudeCode"]["extraUsage"] = null;
    const extra = data.extra_usage;
    if (extra && typeof extra === "object") {
      const e = extra as Record<string, unknown>;
      extraUsage = {
        enabled: e.is_enabled === true,
        spent: typeof e.used_credits === "number" ? e.used_credits : 0,
        limit: typeof e.monthly_limit === "number" ? e.monthly_limit : 0,
      };
    }

    const plan =
      credentials.claudeAiOauth.subscriptionType ??
      credentials.claudeAiOauth.rateLimitTier ??
      null;

    return { available: true, plan, tiers, extraUsage, error: null };
  } catch (err) {
    return {
      available: true,
      plan: credentials.claudeAiOauth.subscriptionType ?? null,
      tiers: [],
      extraUsage: null,
      error: err instanceof Error ? err.message : "Failed to fetch usage",
    };
  }
}

export async function fetchProviderUsage(): Promise<ProviderUsageResult> {
  const [claudeCode] = await Promise.all([fetchClaudeUsage()]);

  return {
    claudeCode,
    codex: {
      available: false,
      plan: null,
      tiers: [],
      extraUsage: null,
      error: null,
    },
  };
}

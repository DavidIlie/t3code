import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ProviderKind } from "@t3tools/contracts";
import { getDefaultModel, getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
import { SearchIcon, TerminalIcon, XIcon } from "lucide-react";

import { type AppSettings, MAX_CUSTOM_MODEL_LENGTH, useAppSettings } from "../appSettings";
import { AVAILABLE_PROVIDER_OPTIONS } from "../components/ProviderModelPicker";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { APP_VERSION } from "../branding";
import { SidebarInset } from "~/components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import McpStatusPanel from "../components/McpStatusPanel";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

function ThemePreviewPane({ isDark }: { isDark: boolean }) {
  const bg = isDark ? "bg-[#1a1a2e]" : "bg-[#f5f5f7]";
  const sidebar = isDark ? "bg-[#12121f]" : "bg-[#e8e8ec]";
  const titleBar = isDark ? "bg-[#252540]" : "bg-[#dcdce0]";
  const content = isDark ? "bg-[#20203a]" : "bg-[#ffffff]";
  const accent = "bg-primary";
  const dot1 = isDark ? "bg-red-400" : "bg-red-500";
  const dot2 = isDark ? "bg-amber-400" : "bg-amber-500";
  const dot3 = isDark ? "bg-emerald-400" : "bg-emerald-500";

  return (
    <div className={`h-full w-full overflow-hidden rounded-md ${bg}`}>
      <div className="flex h-full">
        {/* Sidebar */}
        <div className={`w-[28%] ${sidebar} p-1`}>
          <div className="flex gap-[2px] mb-1">
            <span className={`size-[3px] rounded-full ${dot1}`} />
            <span className={`size-[3px] rounded-full ${dot2}`} />
            <span className={`size-[3px] rounded-full ${dot3}`} />
          </div>
          <div className={`mb-0.5 h-[3px] w-[70%] rounded-sm ${titleBar}`} />
          <div className={`mb-0.5 h-[3px] w-[50%] rounded-sm ${titleBar} opacity-50`} />
          <div className={`h-[3px] w-[60%] rounded-sm ${titleBar} opacity-30`} />
        </div>
        {/* Main content */}
        <div className="flex-1 p-1">
          <div className={`mb-1 h-[5px] w-full rounded-sm ${titleBar}`} />
          <div className={`mb-0.5 h-[3px] w-[80%] rounded-sm ${content}`} />
          <div className={`mb-0.5 h-[3px] w-[60%] rounded-sm ${content}`} />
          <div className={`mt-1 h-[5px] w-[40%] rounded-sm ${accent}`} />
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ variant }: { variant: string }) {
  if (variant === "system") {
    return (
      <div className="flex h-16 w-24 overflow-hidden rounded-lg border border-border">
        <div className="w-1/2">
          <ThemePreviewPane isDark={false} />
        </div>
        <div className="w-1/2">
          <ThemePreviewPane isDark={true} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-16 w-24 overflow-hidden rounded-lg border border-border">
      <ThemePreviewPane isDark={variant === "dark"} />
    </div>
  );
}

const MODEL_PROVIDER_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  {
    provider: "claudeCode",
    title: "Claude Code",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
] as const;

function getCustomModelsForProvider(
  settings: ReturnType<typeof useAppSettings>["settings"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "claudeCode":
      return settings.customClaudeModels;
    case "cursor":
      return settings.customCursorModels;
    case "codex":
    default:
      return settings.customCodexModels;
  }
}

function getDefaultCustomModelsForProvider(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "claudeCode":
      return defaults.customClaudeModels;
    case "cursor":
      return defaults.customCursorModels;
    case "codex":
    default:
      return defaults.customCodexModels;
  }
}

function patchCustomModels(provider: ProviderKind, models: string[]) {
  switch (provider) {
    case "claudeCode":
      return { customClaudeModels: models };
    case "cursor":
      return { customCursorModels: models };
    case "codex":
    default:
      return { customCodexModels: models };
  }
}

function TerminalSettingsSection({
  settings,
  updateSettings,
  defaults,
}: {
  settings: ReturnType<typeof useAppSettings>["settings"];
  updateSettings: ReturnType<typeof useAppSettings>["updateSettings"];
  defaults: ReturnType<typeof useAppSettings>["defaults"];
}) {
  const [shells, setShells] = useState<Array<{ path: string; label: string }>>([]);
  const [systemDefault, setSystemDefault] = useState("");
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    const api = ensureNativeApi();
    void api.terminal
      .listShells()
      .then((result) => {
        setShells(result.shells);
        setSystemDefault(result.defaultShell);
      })
      .catch(() => {});
  }, []);

  const currentShell = settings.defaultShell || systemDefault || "";
  const currentLabel =
    shells.find((s) => s.path === currentShell)?.label ??
    (currentShell ? currentShell.split("/").pop() : "System default");

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Terminal</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure the default shell for new terminal sessions.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-foreground">Default shell</span>
        <Select
          items={[
            { label: "System default", value: "" },
            ...shells.map((s) => ({ label: s.label, value: s.path })),
          ]}
          value={settings.defaultShell}
          onValueChange={(value) => {
            if (value === undefined) return;
            updateSettings({ defaultShell: value ?? "" });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="System default" />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value="">
              <div className="flex items-center gap-2">
                <TerminalIcon className="size-3.5" />
                System default
              </div>
            </SelectItem>
            {shells.map((shell) => (
              <SelectItem key={shell.path} value={shell.path}>
                <div className="flex items-center gap-2">
                  <TerminalIcon className="size-3.5" />
                  {shell.label}
                </div>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <span className="text-xs text-muted-foreground">
          Current: <span className="font-medium text-foreground">{currentLabel}</span>
        </span>
      </label>

      {settings.defaultShell !== defaults.defaultShell ? (
        <div className="mt-3 flex justify-end">
          <Button
            size="xs"
            variant="outline"
            onClick={() => updateSettings({ defaultShell: defaults.defaultShell })}
          >
            Restore default
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ShellCommandSection() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void window.desktopBridge?.isShellCommandInstalled?.().then(setInstalled).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setLoading(true);
    const action = installed
      ? window.desktopBridge?.uninstallShellCommand?.()
      : window.desktopBridge?.installShellCommand?.();
    void action
      ?.then(() => {
        setInstalled((prev) => !prev);
        toastManager.add({
          type: "success",
          title: installed ? "Shell command uninstalled" : "Shell command installed",
        });
      })
      .catch(() => {
        toastManager.add({
          type: "error",
          title: installed ? "Failed to uninstall shell command" : "Failed to install shell command",
        });
      })
      .finally(() => setLoading(false));
  }, [installed]);

  const methodsAvailable = !!window.desktopBridge?.isShellCommandInstalled;

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Shell Command</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Install or uninstall the <code className="rounded bg-muted px-1 py-0.5 text-[10px]">gurt</code> CLI
          command so you can launch T3 Gurt from any terminal.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
        <div>
          <p className="text-sm font-medium text-foreground">
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">gurt</code> command
          </p>
          <p className="text-xs text-muted-foreground">
            {!methodsAvailable
              ? "Not available in this build."
              : installed === null
                ? "Checking..."
                : installed
                  ? "Currently installed."
                  : "Not installed."}
          </p>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={!methodsAvailable || installed === null || loading}
          onClick={toggle}
        >
          {loading ? "Working..." : installed ? "Uninstall" : "Install"}
        </Button>
      </div>
    </section>
  );
}

/** Searchable section keywords -- lowercase. */
const SECTION_SEARCH_DATA: Record<string, string[]> = {
  appearance: ["appearance", "theme", "light", "dark", "system", "timestamp", "format"],
  usage: ["usage", "sidebar", "bars", "rate limit", "tiers"],
  codex: ["codex", "binary", "path", "home", "app server"],
  claude: ["claude", "claude code", "binary", "base url", "api", "anthropic"],
  models: ["models", "model", "slug", "provider", "default", "codex", "claude"],
  responses: ["responses", "stream", "streaming", "assistant"],
  developer: ["developer", "debug", "tool calls", "group"],
  terminal: ["terminal", "shell", "default shell"],
  notifications: ["notifications", "permission", "os", "alert"],
  keybindings: ["keybindings", "keyboard", "shortcuts", "json"],
  shell_command: ["shell", "command", "gurt", "install", "symlink", "path"],
  safety: ["safety", "confirm", "delete", "worktree", "thread"],
  commit_messages: ["commit", "message", "instructions", "conventional"],
  tray: ["tray", "icon", "system tray", "menu"],
  about: ["about", "version", "source", "david"],
  mcp: ["mcp", "servers", "model context protocol", "status"],
};

function sectionMatchesSearch(sectionId: string, query: string): boolean {
  if (!query) return true;
  const lower = query.toLowerCase();
  const keywords = SECTION_SEARCH_DATA[sectionId];
  if (!keywords) return true;
  return keywords.some((kw) => kw.includes(lower));
}

function SettingsRouteView() {
  const { theme, setTheme } = useTheme();
  const { settings, defaults, updateSettings: rawUpdateSettings } = useAppSettings();
  const saveToastTimeout = useRef<ReturnType<typeof setTimeout>>(null);
  const updateSettings = useCallback(
    (patch: Partial<typeof settings>) => {
      rawUpdateSettings(patch);
      if (saveToastTimeout.current) clearTimeout(saveToastTimeout.current);
      saveToastTimeout.current = setTimeout(() => {
        toastManager.add({
          type: "success",
          title: "Settings saved",
        });
      }, 300);
    },
    [rawUpdateSettings],
  );
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl+F focuses the search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const show = useMemo(() => {
    const q = searchQuery.trim();
    const result: Record<string, boolean> = {};
    for (const key of Object.keys(SECTION_SEARCH_DATA)) {
      result[key] = sectionMatchesSearch(key, q);
    }
    return result;
  }, [searchQuery]);

  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeCode: "",
    cursor: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});

  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const claudeBinaryPath = settings.claudeBinaryPath;
  const claudeBaseUrl = settings.claudeBaseUrl;
  const claudeApiKey = settings.claudeApiKey;
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const availableEditors = serverConfigQuery.data?.availableEditors;

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError("No available editors found.");
      setIsOpeningKeybindings(false);
      return;
    }
    void api.shell
      .openInEditor(keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [availableEditors, keybindingsConfigPath]);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-3">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground">
                  Configure app-level preferences for this device. Changes save automatically.
                </p>
              </div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search settings... (⌘F)"
                  className="pl-9 pr-8"
                  spellCheck={false}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/50 hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
            </header>

            {show.appearance && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how T3 Gurt handles light and dark mode.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex gap-3" role="radiogroup" aria-label="Theme preference">
                  {THEME_OPTIONS.map((option) => {
                    const selected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`group flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition-all ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover:border-border"
                        }`}
                        onClick={() => setTheme(option.value)}
                      >
                        <ThemePreview variant={option.value} />
                        <span
                          className={`text-xs ${selected ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                        >
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Timestamp format</p>
                    <p className="text-xs text-muted-foreground">
                      How timestamps are displayed in the chat timeline.
                    </p>
                  </div>
                  <Select
                    value={settings.timestampFormat}
                    onValueChange={(value) =>
                      updateSettings({
                        timestampFormat: value as AppSettings["timestampFormat"],
                      })
                    }
                  >
                    <SelectTrigger className="w-32" aria-label="Timestamp format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="locale">System</SelectItem>
                      <SelectItem value="12-hour">12-hour</SelectItem>
                      <SelectItem value="24-hour">24-hour</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            </section>}

            {show.usage && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Usage</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how API usage and rate limit information is displayed.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Sidebar usage bars</p>
                  <p className="text-xs text-muted-foreground">
                    Show usage tier bars in the sidebar footer for at-a-glance rate limit visibility.
                  </p>
                </div>
                <Switch
                  checked={settings.showUsageBars}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      showUsageBars: Boolean(checked),
                    })
                  }
                  aria-label="Show sidebar usage bars"
                />
              </div>

              {settings.showUsageBars !== defaults.showUsageBars ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        showUsageBars: defaults.showUsageBars,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>}

            {show.codex && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Codex App Server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a non-default Codex install.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="codex-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Codex binary path</span>
                  <Input
                    id="codex-binary-path"
                    value={codexBinaryPath}
                    onChange={(event) => updateSettings({ codexBinaryPath: event.target.value })}
                    placeholder="codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>codex</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="codex-home-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                  <Input
                    id="codex-home-path"
                    value={codexHomePath}
                    onChange={(event) => updateSettings({ codexHomePath: event.target.value })}
                    placeholder="/Users/you/.codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional custom Codex home/config directory.
                  </span>
                </label>

                <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p>Binary source</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-foreground">
                      {codexBinaryPath || "PATH"}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="self-start"
                    onClick={() =>
                      updateSettings({
                        codexBinaryPath: defaults.codexBinaryPath,
                        codexHomePath: defaults.codexHomePath,
                      })
                    }
                  >
                    Reset codex overrides
                  </Button>
                </div>
              </div>
            </section>}

            {show.claude && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Claude Code</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a custom Claude Code setup or non-Anthropic endpoint.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="claude-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Claude binary path</span>
                  <Input
                    id="claude-binary-path"
                    value={claudeBinaryPath}
                    onChange={(event) => updateSettings({ claudeBinaryPath: event.target.value })}
                    placeholder="claude"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>claude</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="claude-base-url" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">ANTHROPIC_BASE_URL</span>
                  <Input
                    id="claude-base-url"
                    value={claudeBaseUrl}
                    onChange={(event) => updateSettings({ claudeBaseUrl: event.target.value })}
                    placeholder="https://api.anthropic.com"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Override the Anthropic API base URL for non-Anthropic models or proxies.
                  </span>
                </label>

                <label htmlFor="claude-api-key" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">ANTHROPIC_API_KEY</span>
                  <Input
                    id="claude-api-key"
                    type="password"
                    value={claudeApiKey}
                    onChange={(event) => updateSettings({ claudeApiKey: event.target.value })}
                    placeholder="sk-ant-..."
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional API key override for the Claude Code provider.
                  </span>
                </label>

                <div className="flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        claudeBinaryPath: defaults.claudeBinaryPath,
                        claudeBaseUrl: defaults.claudeBaseUrl,
                        claudeApiKey: defaults.claudeApiKey,
                      })
                    }
                  >
                    Reset Claude overrides
                  </Button>
                </div>
              </div>
            </section>}

            {show.models && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Default provider</span>
                  <Select
                    items={AVAILABLE_PROVIDER_OPTIONS.map((option) => ({
                      label: option.label,
                      value: option.value,
                    }))}
                    value={settings.defaultProvider}
                    onValueChange={(value) => {
                      if (!value) return;
                      updateSettings({ defaultProvider: value, defaultModel: "" });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {AVAILABLE_PROVIDER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    The provider pre-selected when creating new threads.
                  </span>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Default model</span>
                  <Select
                    items={getModelOptions(settings.defaultProvider).map((option) => ({
                      label: option.name,
                      value: option.slug,
                    }))}
                    value={settings.defaultModel || getDefaultModel(settings.defaultProvider)}
                    onValueChange={(value) => {
                      if (!value) return;
                      updateSettings({ defaultModel: value ?? "" });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {getModelOptions(settings.defaultProvider).map((option) => (
                        <SelectItem key={option.slug} value={option.slug}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    The model pre-selected when creating new threads.
                  </span>
                </label>

                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModels(provider, [
                                      ...getDefaultCustomModelsForProvider(defaults, provider),
                                    ]),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                      {slug}
                                    </code>
                                  </div>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>}

            {show.responses && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>}

            {show.developer && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Developer</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Debug tools and developer-facing options.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Debug mode</p>
                  <p className="text-xs text-muted-foreground">
                    Show a debug overlay with session, turn, and usage details. Toggle with{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/debug</code> in any
                    chat.
                  </p>
                </div>
                <Switch
                  checked={settings.debugMode}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      debugMode: Boolean(checked),
                    })
                  }
                  aria-label="Enable debug mode"
                />
              </div>

            </section>}

            {show.terminal && <TerminalSettingsSection
              settings={settings}
              updateSettings={updateSettings}
              defaults={defaults}
            />}

            {show.keybindings && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>}

            {show.safety && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>}

            {show.commit_messages && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Commit Message Instructions</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Custom instructions for AI-generated commit messages.
                </p>
              </div>

              <label className="block space-y-1">
                <Textarea
                  value={settings.commitMessageInstructions}
                  onChange={(e) =>
                    updateSettings({ commitMessageInstructions: e.target.value })
                  }
                  placeholder="e.g. Use conventional commits format, keep subject under 72 characters..."
                  spellCheck={false}
                  rows={3}
                />
              </label>

              {settings.commitMessageInstructions !== defaults.commitMessageInstructions ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        commitMessageInstructions: defaults.commitMessageInstructions,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>}

            {show.tray && isElectron && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Tray</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control the system tray icon behavior.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Show tray icon</p>
                  <p className="text-xs text-muted-foreground">
                    Show T3 Gurt in the system tray for quick access.
                  </p>
                </div>
                <Switch
                  checked={settings.showTrayIcon}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      showTrayIcon: Boolean(checked),
                    })
                  }
                  aria-label="Show tray icon"
                />
              </div>

              {settings.showTrayIcon !== defaults.showTrayIcon ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        showTrayIcon: defaults.showTrayIcon,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>}

            {show.shell_command && isElectron && <ShellCommandSection />}

            {show.about && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">About</h2>
              </div>

              <div className="mb-4 rounded-lg border border-border bg-background px-4 py-3">
                <p className="text-sm font-medium text-foreground">
                  An opinionated fork by{" "}
                  <a
                    href="https://davidilie.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-primary"
                  >
                    David Ilie
                  </a>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Based on{" "}
                  <a
                    href="https://github.com/pingdotgg/t3code"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    T3 Code
                  </a>{" "}
                  by Ping.gg — forked as T3 Gurt
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Version</p>
                  </div>
                  <code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Source Code</p>
                  </div>
                  <a
                    href="https://github.com/DavidIlie/t3code"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    DavidIlie/t3code
                  </a>
                </div>
              </div>
            </section>}

            {show.mcp && <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">MCP Servers</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  View the status of MCP servers connected across active sessions.
                </p>
              </div>
              <McpStatusPanel />
            </section>}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});

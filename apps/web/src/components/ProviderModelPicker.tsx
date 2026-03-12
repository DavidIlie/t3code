import { memo, useState } from "react";
import type { ModelSlug, ProviderKind } from "@t3tools/contracts";
import {
  getCursorModelFamilyOptions,
  normalizeModelSlug,
  parseCursorModelSelection,
} from "@t3tools/shared/model";
import { ChevronDownIcon } from "lucide-react";

import {
  getAppModelOptions,
} from "../appSettings";
import {
  type ProviderPickerKind,
  PROVIDER_OPTIONS,
} from "../session-logic";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";
import {
  ClaudeAI,
  CursorIcon,
  Gemini,
  type Icon,
  OpenAI,
  OpenCodeIcon,
} from "./Icons";

// ── Helpers ──────────────────────────────────────────────────────────

function isAvailableProviderOption(
  option: (typeof PROVIDER_OPTIONS)[number],
): option is {
  value: ProviderKind;
  label: string;
  available: true;
} {
  return option.available;
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption);
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.available);
const COMING_SOON_PROVIDER_OPTIONS = [
  { id: "opencode", label: "OpenCode", icon: OpenCodeIcon },
  { id: "gemini", label: "Gemini", icon: Gemini },
] as const;

export function getCustomModelOptionsByProvider(settings: {
  customCodexModels: readonly string[];
  customClaudeModels: readonly string[];
  customCursorModels: readonly string[];
}): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const cursorFamilyOptions = getCursorModelFamilyOptions();
  return {
    codex: getAppModelOptions("codex", settings.customCodexModels),
    claudeCode: getAppModelOptions("claudeCode", settings.customClaudeModels),
    cursor: [
      ...cursorFamilyOptions,
      ...getAppModelOptions("cursor", settings.customCursorModels).filter(
        (option) =>
          option.isCustom && !cursorFamilyOptions.some((family) => family.slug === option.slug),
      ),
    ],
  };
}

export const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeCode: ClaudeAI,
  cursor: CursorIcon,
};

export function resolveModelForProviderPicker(
  provider: ProviderKind,
  value: string,
  options: ReadonlyArray<{ slug: string; name: string }>,
): ModelSlug | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmedValue);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmedValue.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmedValue, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  if (resolved) {
    return resolved.slug;
  }

  if (provider === "cursor") {
    return parseCursorModelSelection(normalized).family;
  }

  return null;
}

// ── Component ────────────────────────────────────────────────────────

const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: ModelSlug;
  lockedProvider: ProviderKind | null;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  compact?: boolean;
  disabled?: boolean;
  onProviderModelChange: (provider: ProviderKind, model: ModelSlug) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const selectedProviderOptions = props.modelOptionsByProvider[props.provider];
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ?? props.model;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.provider];

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "min-w-0 shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80",
              props.compact ? "max-w-42" : "sm:px-3",
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 items-center gap-2",
            props.compact ? "max-w-36" : undefined,
          )}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              props.provider === "claudeCode" ? "" : "text-muted-foreground/70",
            )}
          />
          <span className="truncate">{selectedModelLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {AVAILABLE_PROVIDER_OPTIONS.map((option) => {
          const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
          const isDisabledByProviderLock =
            props.lockedProvider !== null && props.lockedProvider !== option.value;
          return (
            <MenuSub key={option.value}>
              <MenuSubTrigger disabled={isDisabledByProviderLock}>
                <OptionIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground/85"
                />
                {option.label}
              </MenuSubTrigger>
              <MenuSubPopup className="[--available-height:min(24rem,70vh)]">
                <MenuGroup>
                  <MenuRadioGroup
                    value={props.provider === option.value ? props.model : ""}
                    onValueChange={(value) => {
                      if (props.disabled) return;
                      if (isDisabledByProviderLock) return;
                      if (!value) return;
                      const resolvedModel = resolveModelForProviderPicker(
                        option.value,
                        value,
                        props.modelOptionsByProvider[option.value],
                      );
                      if (!resolvedModel) return;
                      props.onProviderModelChange(option.value, resolvedModel);
                      setIsMenuOpen(false);
                    }}
                  >
                    {props.modelOptionsByProvider[option.value].map((modelOption) => (
                      <MenuRadioItem
                        key={`${option.value}:${modelOption.slug}`}
                        value={modelOption.slug}
                        onClick={() => setIsMenuOpen(false)}
                      >
                        {modelOption.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </MenuSubPopup>
            </MenuSub>
          );
        })}
        {UNAVAILABLE_PROVIDER_OPTIONS.length > 0 && <MenuDivider />}
        {UNAVAILABLE_PROVIDER_OPTIONS.map((option) => {
          const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
          return (
            <MenuItem key={option.value} disabled>
              <OptionIcon
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 opacity-80",
                  option.value === "claudeCode" ? "" : "text-muted-foreground/85",
                )}
              />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                Coming soon
              </span>
            </MenuItem>
          );
        })}
        {UNAVAILABLE_PROVIDER_OPTIONS.length === 0 && <MenuDivider />}
        {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          return (
            <MenuItem key={option.id} disabled>
              <OptionIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />
              <span>{option.label}</span>
              <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                Coming soon
              </span>
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
});

export default ProviderModelPicker;

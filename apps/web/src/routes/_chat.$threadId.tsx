import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
  stripHistorySearchParams,
} from "../diffRouteSearch";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import { DiffPanelLoadingState, type DiffPanelMode } from "../components/DiffPanelShell";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStore } from "../store";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const GitHistoryPanel = lazy(() => import("../components/GitHistoryPanel"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const HISTORY_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_history_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const LazyDiffPanel = ({ mode, onClose }: { mode: DiffPanelMode; onClose?: () => void }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffPanelLoadingState mode={mode} />}>
        <DiffPanel mode={mode} onClose={onClose} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const LazyHistoryPanel = ({ mode, onClose }: { mode: DiffPanelMode; onClose?: () => void }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffPanelLoadingState mode={mode} />}>
        <GitHistoryPanel mode={mode} onClose={onClose} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const makeShouldAcceptInlineSidebarWidth = () => {
  return ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
    const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
    if (!composerForm) return true;
    const composerViewport = composerForm.parentElement;
    if (!composerViewport) return true;
    const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
    wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

    const viewportStyle = window.getComputedStyle(composerViewport);
    const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
    const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
    const viewportContentWidth = Math.max(
      0,
      composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
    );
    const formRect = composerForm.getBoundingClientRect();
    const composerFooter = composerForm.querySelector<HTMLElement>(
      "[data-chat-composer-footer='true']",
    );
    const composerRightActions = composerForm.querySelector<HTMLElement>(
      "[data-chat-composer-actions='right']",
    );
    const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
    const composerFooterGap = composerFooter
      ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
        Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
        0
      : 0;
    const minimumComposerWidth =
      COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
    const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
    const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
    const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

    if (previousSidebarWidth.length > 0) {
      wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
    } else {
      wrapper.style.removeProperty("--sidebar-width");
    }

    return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
  };
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  shouldRenderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, shouldRenderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useMemo(() => makeShouldAcceptInlineSidebarWidth(), []);

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {shouldRenderDiffContent ? (
          <LazyDiffPanel mode="sidebar" />
        ) : (
          <DiffPanelLoadingState mode="sidebar" />
        )}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const HistoryPanelInlineSidebar = (props: {
  historyOpen: boolean;
  onCloseHistory: () => void;
  onOpenHistory: () => void;
  shouldRenderHistoryContent: boolean;
}) => {
  const { historyOpen, onCloseHistory, onOpenHistory, shouldRenderHistoryContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenHistory();
        return;
      }
      onCloseHistory();
    },
    [onCloseHistory, onOpenHistory],
  );
  const shouldAcceptInlineSidebarWidth = useMemo(() => makeShouldAcceptInlineSidebarWidth(), []);

  return (
    <SidebarProvider
      defaultOpen={false}
      open={historyOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: HISTORY_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {shouldRenderHistoryContent ? (
          <LazyHistoryPanel mode="sidebar" />
        ) : (
          <DiffPanelLoadingState mode="sidebar" />
        )}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = threadExists || draftThreadExists;
  const diffOpen = search.diff === "1";
  const historyOpen = search.history === "1";
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const [hasOpenedHistory, setHasOpenedHistory] = useState(historyOpen);
  const shouldUseSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const shouldRenderHistoryContent = historyOpen || hasOpenedHistory;

  useEffect(() => {
    if (diffOpen) setHasOpenedDiff(true);
  }, [diffOpen]);
  useEffect(() => {
    if (historyOpen) setHasOpenedHistory(true);
  }, [historyOpen]);

  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => stripDiffSearchParams(previous),
    });
  }, [navigate, threadId]);
  const openDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [navigate, threadId]);

  const closeHistory = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => stripHistorySearchParams(previous),
    });
  }, [navigate, threadId]);
  const openHistory = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, history: "1" };
      },
    });
  }, [navigate, threadId]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
      return;
    }
  }, [navigate, routeThreadExists, threadsHydrated, threadId]);

  if (!threadsHydrated || !routeThreadExists) {
    return null;
  }

  // Determine which side panel to render (mutually exclusive)
  const activeSidePanel = historyOpen ? "history" : diffOpen ? "diff" : null;

  if (!shouldUseSheet) {
    return (
      <>
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView key={threadId} threadId={threadId} />
        </SidebarInset>
        {activeSidePanel === "history" ? (
          <HistoryPanelInlineSidebar
            historyOpen={historyOpen}
            onCloseHistory={closeHistory}
            onOpenHistory={openHistory}
            shouldRenderHistoryContent={shouldRenderHistoryContent}
          />
        ) : (
          <DiffPanelInlineSidebar
            diffOpen={diffOpen}
            onCloseDiff={closeDiff}
            onOpenDiff={openDiff}
            shouldRenderDiffContent={shouldRenderDiffContent}
          />
        )}
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView key={threadId} threadId={threadId} />
      </SidebarInset>
      <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
        {shouldRenderDiffContent ? (
          <LazyDiffPanel mode="sheet" onClose={closeDiff} />
        ) : (
          <DiffPanelLoadingState mode="sheet" />
        )}
      </DiffPanelSheet>
      <DiffPanelSheet diffOpen={historyOpen} onCloseDiff={closeHistory}>
        {shouldRenderHistoryContent ? (
          <LazyHistoryPanel mode="sheet" onClose={closeHistory} />
        ) : (
          <DiffPanelLoadingState mode="sheet" />
        )}
      </DiffPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff", "history"])],
  },
  component: ChatThreadRouteView,
});

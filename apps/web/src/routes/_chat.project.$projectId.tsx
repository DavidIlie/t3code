import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";

import ProjectLandingPage from "../components/ProjectLandingPage";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripHistorySearchParams,
} from "../diffRouteSearch";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import { DiffPanelLoadingState, type DiffPanelMode } from "../components/DiffPanelShell";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStore } from "../store";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const GitHistoryPanel = lazy(() => import("../components/GitHistoryPanel"));
const HISTORY_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const HISTORY_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "project_history_sidebar_width";
const HISTORY_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const HISTORY_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;

const LazyHistoryPanel = ({ mode }: { mode: DiffPanelMode }) => (
  <DiffWorkerPoolProvider>
    <Suspense fallback={<DiffPanelLoadingState mode={mode} />}>
      <GitHistoryPanel mode={mode} />
    </Suspense>
  </DiffWorkerPoolProvider>
);

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

  return (
    <SidebarProvider
      defaultOpen={false}
      open={historyOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": HISTORY_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: HISTORY_INLINE_SIDEBAR_MIN_WIDTH,
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

function ProjectRouteView() {
  const navigate = useNavigate();
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const projectExists = useStore((store) => store.projects.some((p) => p.id === projectId));
  const historyOpen = search.history === "1";
  const [hasOpenedHistory, setHasOpenedHistory] = useState(historyOpen);
  const shouldUseSheet = useMediaQuery(HISTORY_INLINE_LAYOUT_MEDIA_QUERY);
  const shouldRenderHistoryContent = historyOpen || hasOpenedHistory;

  useEffect(() => {
    if (historyOpen) setHasOpenedHistory(true);
  }, [historyOpen]);

  const closeHistory = useCallback(() => {
    void navigate({
      to: "/project/$projectId",
      params: { projectId },
      search: (previous) => ({
        ...stripHistorySearchParams(previous),
        history: undefined,
      }),
    });
  }, [navigate, projectId]);

  const openHistory = useCallback(() => {
    void navigate({
      to: "/project/$projectId",
      params: { projectId },
      search: (previous) => ({ ...previous, history: "1" as const }),
    });
  }, [navigate, projectId]);

  useEffect(() => {
    if (!projectExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [projectExists, navigate]);

  if (!projectExists) {
    return null;
  }

  if (!shouldUseSheet) {
    return (
      <>
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ProjectLandingPage
            historyOpen={historyOpen}
            onToggleHistory={historyOpen ? closeHistory : openHistory}
          />
        </SidebarInset>
        <HistoryPanelInlineSidebar
          historyOpen={historyOpen}
          onCloseHistory={closeHistory}
          onOpenHistory={openHistory}
          shouldRenderHistoryContent={shouldRenderHistoryContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ProjectLandingPage
          historyOpen={historyOpen}
          onToggleHistory={historyOpen ? closeHistory : openHistory}
        />
      </SidebarInset>
      <Sheet
        open={historyOpen}
        onOpenChange={(open) => {
          if (!open) closeHistory();
        }}
      >
        <SheetPopup
          side="right"
          showCloseButton={false}
          keepMounted
          className="w-[min(88vw,820px)] max-w-[820px] p-0"
        >
          {shouldRenderHistoryContent ? (
            <LazyHistoryPanel mode="sheet" />
          ) : (
            <DiffPanelLoadingState mode="sheet" />
          )}
        </SheetPopup>
      </Sheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/project/$projectId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["history"])],
  },
  component: ProjectRouteView,
});

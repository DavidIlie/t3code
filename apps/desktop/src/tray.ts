import {
  nativeImage,
  app,
  ipcMain,
  Tray,
  Menu,
  type MenuItemConstructorOptions,
  type BrowserWindow,
} from "electron";
import path from "node:path";
import type {
  DesktopTrayState,
  DesktopTrayMessage,
  DesktopTrayThread,
  ThreadId,
} from "@t3tools/contracts";

const SET_TRAY_ENABLED_CHANNEL = "desktop:set-tray-enabled";
const GET_TRAY_STATE_CHANNEL = "desktop:get-tray-state";
const SET_TRAY_STATE_CHANNEL = "desktop:set-tray-state";
const TRAY_MESSAGE_CHANNEL = "desktop:tray-message";

let tray: Tray | null = null;
let getMainWindow: (() => BrowserWindow | null) | null = null;

let trayState: DesktopTrayState = {
  threads: [],
};

function truncateGraphemes(value: string, maxLength: number): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const graphemes = Array.from(segmenter.segment(value), (segment) => segment.segment);

  if (graphemes.length <= maxLength) {
    return value;
  }

  return `${graphemes.slice(0, maxLength).join("")}...`;
}

const MAX_THREAD_NAME_LENGTH = 20;
const MAX_THREADS_IN_CONTEXT_MENU = 3;
const MAX_VIEW_MORE_THREADS = 5;

function buildTrayContextMenu(): Menu {
  const sortedThreads = trayState.threads.toSorted(
    (a: DesktopTrayThread, b: DesktopTrayThread) => b.lastUpdated - a.lastUpdated,
  );
  const topLevelThreads = sortedThreads.slice(0, MAX_THREADS_IN_CONTEXT_MENU);
  const viewMoreThreads = sortedThreads.slice(
    MAX_THREADS_IN_CONTEXT_MENU,
    MAX_THREADS_IN_CONTEXT_MENU + MAX_VIEW_MORE_THREADS,
  );

  function buildThreadMenuItem(
    thread: DesktopTrayState["threads"][number],
  ): MenuItemConstructorOptions {
    return {
      label: `${thread.needsAttention ? "\u00B7" : ""} ${truncateGraphemes(thread.name, MAX_THREAD_NAME_LENGTH)}`,
      click: () => {
        const mainWin = getMainWindow?.();
        if (!mainWin) return;
        sendTrayMessage({ type: "thread-click", threadId: thread.id as ThreadId }, mainWin);
        mainWin.focus();
      },
    };
  }

  const menuItems: MenuItemConstructorOptions[] = [];

  if (topLevelThreads.length > 0) {
    menuItems.push(...topLevelThreads.map(buildThreadMenuItem));

    if (viewMoreThreads.length > 0) {
      menuItems.push({
        type: "submenu",
        label: `View More (${viewMoreThreads.length})`,
        submenu: viewMoreThreads.map(buildThreadMenuItem),
      });
    }

    menuItems.push({ type: "separator" });
  }

  menuItems.push({
    label: "Show Window",
    click: () => {
      const mainWin = getMainWindow?.();
      if (mainWin) {
        mainWin.show();
        mainWin.focus();
      }
    },
  });

  menuItems.push({
    label: "Quit",
    click: () => app.quit(),
  });

  return Menu.buildFromTemplate(menuItems);
}

function updateTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildTrayContextMenu());
  const threadsNeedingAttention = trayState.threads.filter(
    (t: DesktopTrayThread) => t.needsAttention,
  ).length;
  if (threadsNeedingAttention > 0) {
    tray.setTitle(`(${threadsNeedingAttention} unread)`);
  } else {
    tray.setTitle("");
  }
}

function createTray(): void {
  if (process.platform !== "darwin") return;

  const iconPath = path.join(__dirname, "..", "resources", "icon.png");
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  image.setTemplateImage(true);

  const newTray = new Tray(image);
  newTray.setToolTip(app.getName());
  tray = newTray;
}

function sendTrayMessage(message: DesktopTrayMessage, window: BrowserWindow): void {
  window.webContents.send(TRAY_MESSAGE_CHANNEL, message);
}

export function setupTrayIpcHandlers(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter;

  ipcMain.handle(SET_TRAY_ENABLED_CHANNEL, async (_event, enabled: boolean) => {
    await setTrayEnabled(enabled);
  });
  ipcMain.handle(GET_TRAY_STATE_CHANNEL, async () => {
    return trayState;
  });
  ipcMain.handle(SET_TRAY_STATE_CHANNEL, async (_event, state: DesktopTrayState) => {
    trayState = state;
    updateTray();
  });
}

export async function setTrayEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    if (tray && !tray.isDestroyed()) return;
    createTray();
    updateTray();
  } else {
    if (tray && !tray.isDestroyed()) tray.destroy();
    tray = null;
  }
}

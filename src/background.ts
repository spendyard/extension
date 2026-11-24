// The extension's service worker:
//
// - the toolbar button opens the side panel (panel.ts), which does the rest;
// - the right-click menu sends a link, an image or the page: it opens the
//   panel and leaves the receipt for it to send (pending.ts);
// - the dashboard's /connect/extension page hands over the token, which is
//   kept (connection.ts), and its tab closed.

import { looksLikeId, type Found } from "./found";
import { keep, knownServer, type Connection } from "./connection";
import { add } from "./pending";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e: unknown) => console.error("couldn't make the button open the panel", e));

const menu = {
  link: "send-link",
  image: "send-image",
  page: "send-page",
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: menu.link, title: "Send link to Spendyard", contexts: ["link"] });
    chrome.contextMenus.create({ id: menu.image, title: "Send image to Spendyard", contexts: ["image"] });
    chrome.contextMenus.create({ id: menu.page, title: "Send this page to Spendyard", contexts: ["page", "frame"] });
  });
});

/** What was right-clicked, as the panel's scan would have found it. */
function foundFrom(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab): Found | null {
  if (info.menuItemId === menu.page) {
    return {
      id: `page:${tab.url}`,
      kind: "page",
      url: tab.url ?? "",
      label: tab.title ?? "This page",
      context: "This page",
      amount: null,
      date: null,
      score: 10,
    };
  }

  const url = info.menuItemId === menu.link ? info.linkUrl : info.srcUrl;

  if (!url) {
    return null;
  }

  // The link's own text where Chrome gives it; a file's name from its URL, but not an id.
  const linkText = (info as { linkText?: string }).linkText?.trim();
  const fromUrl = new URL(url).pathname.split("/").pop() ?? "";
  const label = linkText || info.selectionText || (fromUrl && !looksLikeId(fromUrl) ? fromUrl : new URL(url).hostname);

  return {
    id: url,
    kind: "file",
    url,
    label,
    context: "Sent from the right-click menu",
    amount: null,
    date: null,
    score: 10,
  };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }

  // First, while the click still counts as the person's: opening the panel needs one.
  void chrome.sidePanel.open({ tabId: tab.id });

  const found = foundFrom(info, tab);

  if (found) {
    void add({ tabId: tab.id, found });
  }
});

// ——— The badge: how many receipts the tab's page has ———

/** What a tab's page said it has (watch.ts), and what the panel found once it looked further (panel.ts). */
interface Counted {
  url: string;
  found: number;
  more: boolean;
  panel?: number;
}

const counts = new Map<number, Counted>();

function showBadge(tabId: number) {
  const counted = counts.get(tabId);
  const found = counted ? Math.max(counted.found, counted.panel ?? 0) : 0;
  const text = found > 99 ? "99+" : found > 0 ? String(found) : counted?.more ? "•" : "";

  void chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
}

void chrome.action.setBadgeBackgroundColor({ color: "#4a47f5" });
void chrome.action.setBadgeTextColor?.({ color: "#ffffff" });

interface CountMessage {
  type: "spendyard.count" | "spendyard.panel-count";
  url: string;
  found: number;
  more?: boolean;
  tabId?: number;
}

chrome.runtime.onMessage.addListener((message: CountMessage, sender) => {
  if (message?.type === "spendyard.count" && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const before = counts.get(tabId);

    // Another page: what the panel found was for the last one.
    const panel = before?.url === message.url ? before.panel : undefined;

    counts.set(tabId, { url: message.url, found: message.found, more: Boolean(message.more), panel });
    showBadge(tabId);
  }

  if (message?.type === "spendyard.panel-count" && message.tabId !== undefined && sender.id === chrome.runtime.id && !sender.tab) {
    const before = counts.get(message.tabId);
    const sameUrl = before?.url === message.url;

    counts.set(message.tabId, { url: message.url, found: sameUrl ? before.found : 0, more: sameUrl ? before.more : false, panel: message.found });
    showBadge(message.tabId);
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => counts.delete(tabId));

interface Handed extends Connection {
  type: string;
}

chrome.runtime.onMessageExternal.addListener((message: Handed, sender, answer) => {
  // Only a Spendyard dashboard's page, handing over its own server's token.
  const from = sender.origin ?? "";

  if (message?.type !== "spendyard.connected" || !knownServer(from) || message.server !== from) {
    answer({ ok: false });

    return false;
  }

  const connection: Connection = {
    server: message.server,
    token: message.token,
    org: message.org,
    email: message.email,
  };

  void keep(connection).then(() => {
    answer({ ok: true });

    // The page says it's connected; a moment to read it, then back to where they were.
    const tabId = sender.tab?.id;

    if (tabId !== undefined) {
      setTimeout(() => void chrome.tabs.remove(tabId).catch(() => undefined), 1500);
    }
  });

  // The answer comes once it's kept.
  return true;
});

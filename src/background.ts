// The extension's service worker:
//
// - the toolbar button opens the side panel (panel.ts), which does the rest;
// - the right-click menu sends a link, an image or the page: it opens the
//   panel and leaves the receipt for it to send (pending.ts);
// - the dashboard's /connect/extension page hands over the token, which is
//   kept (connection.ts), and its tab closed.

import type { Found } from "./found";
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

  return {
    id: url,
    kind: "file",
    url,
    label: info.selectionText || new URL(url).pathname.split("/").pop() || url,
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

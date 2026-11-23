// The side panel: connecting to Spendyard; the receipts on the page in the
// active tab (detect.ts), the likely ones ticked, to send; and receipts sent
// from the right-click menu (pending.ts) or dropped on it.

import { disconnect, sendDocument, signedOut, whoAmI } from "./api";
import { connection, connectUrl, forget, isConnectionChange, servers, type Connection } from "./connection";
import { get, type Got } from "./fetch";
import type { Found, Scan } from "./found";
import { isPendingChange, take } from "./pending";

/** Ticked to begin with: the likely ones (detect.ts's score). */
const tickedFrom = 5;

type Status =
  | { state: "sending" }
  | { state: "sent"; documentId: string; seen: boolean }
  | { state: "failed"; message: string };

/** Sent from the right-click menu or dropped here: shown at the top until the panel closes. */
interface Extra {
  id: string;
  label: string;
  kind: string;
}

const state = {
  connection: null as Connection | null,
  tabId: null as number | null,
  scan: null as Scan | null,
  scanError: null as string | null,
  ticked: new Set<string>(),
  status: new Map<string, Status>(),
  extras: [] as Extra[],
};

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  rescan: element<HTMLButtonElement>("rescan"),
  connect: element<HTMLElement>("connect"),
  server: element<HTMLSelectElement>("server"),
  connectButton: element<HTMLButtonElement>("connect-button"),
  connectNote: element<HTMLElement>("connect-note"),
  connected: element<HTMLElement>("connected"),
  who: element<HTMLElement>("who"),
  disconnect: element<HTMLButtonElement>("disconnect"),
  sent: element<HTMLUListElement>("sent"),
  where: element<HTMLElement>("where"),
  list: element<HTMLUListElement>("list"),
  empty: element<HTMLElement>("empty"),
  drop: element<HTMLLabelElement>("drop"),
  files: element<HTMLInputElement>("files"),
  sendPage: element<HTMLButtonElement>("send-page"),
  send: element<HTMLButtonElement>("send"),
};

// ——— Rendering ———

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);

  made.className = className;
  made.textContent = text;

  return made;
}

function statusLine(status: Status | undefined): HTMLElement | null {
  if (!status) {
    return null;
  }

  if (status.state === "sending") {
    return make("div", "status", "Sending…");
  }

  if (status.state === "failed") {
    return make("div", "status failed", status.message);
  }

  const line = make("div", "status sent", status.seen ? "Already in Spendyard · " : "Sent · ");
  const link = make("a", "", "Open");

  link.href = `${state.connection?.server}/documents/${status.documentId}`;
  link.target = "_blank";
  line.append(link);

  return line;
}

const kindWords: Record<string, string> = { file: "File", page: "Page", dropped: "Dropped" };

function foundItem(found: Found): HTMLLIElement {
  const item = make("li", "item");
  const box = document.createElement("input");
  const status = state.status.get(found.id);

  box.type = "checkbox";
  box.checked = state.ticked.has(found.id);
  box.disabled = status?.state === "sending" || status?.state === "sent";
  box.addEventListener("change", () => {
    if (box.checked) {
      state.ticked.add(found.id);
    } else {
      state.ticked.delete(found.id);
    }

    renderFooter();
  });

  const label = make("div", "label");

  label.append(make("span", "kind", kindWords[found.kind] ?? found.kind), found.label);
  item.append(box, label);

  if (found.context && found.context !== found.label) {
    item.append(make("div", "context", found.context));
  }

  const facts = [found.amount, found.date].filter((f): f is string => Boolean(f));

  if (facts.length > 0) {
    const line = make("div", "facts");

    facts.forEach((f) => line.append(make("span", "", f)));
    item.append(line);
  }

  const line = statusLine(status);

  if (line) {
    item.append(line);
  }

  return item;
}

function extraItem(extra: Extra): HTMLLIElement {
  const item = make("li", "item no-box");
  const label = make("div", "label");

  label.append(make("span", "kind", kindWords[extra.kind] ?? extra.kind), extra.label);
  item.append(label);

  const line = statusLine(state.status.get(extra.id));

  if (line) {
    item.append(line);
  }

  return item;
}

function renderFooter() {
  const page = state.scan?.found.find((f) => f.kind === "page");
  const sendable = [...state.ticked].filter((id) => {
    const status = state.status.get(id)?.state;

    return status !== "sending" && status !== "sent";
  });

  ui.send.disabled = sendable.length === 0;
  ui.send.textContent = sendable.length > 1 ? `Send ${sendable.length}` : "Send";

  // The page itself, for when it is a receipt the detection missed.
  ui.sendPage.hidden = Boolean(page) || !state.scan || state.scanError !== null;
}

function render() {
  const connected = state.connection !== null;

  ui.connect.hidden = connected;
  ui.connected.hidden = !connected;
  ui.rescan.hidden = !connected;

  if (!state.connection) {
    return;
  }

  ui.who.textContent = `${state.connection.org.name} · ${state.connection.email}`;
  ui.sent.replaceChildren(...state.extras.map(extraItem));

  const found = state.scan?.found ?? [];

  ui.where.textContent = state.scan ? new URL(state.scan.url).host : "";
  ui.list.replaceChildren(...found.map(foundItem));

  ui.empty.hidden = found.length > 0;
  ui.empty.textContent = state.scanError ?? (state.scan ? "No receipts found on this page." : "Looking…");

  renderFooter();
}

// ——— Scanning the active tab ———

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  return tab;
}

async function scan() {
  const tab = await activeTab();

  if (!tab?.id) {
    return;
  }

  const sameTab = tab.id === state.tabId && state.scan?.url === tab.url;

  state.tabId = tab.id;
  state.scanError = null;

  if (!sameTab) {
    state.scan = null;
    state.ticked.clear();
  }

  render();

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["detect.js"] });

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis as unknown as { spendyardScan: () => unknown }).spendyardScan(),
    });

    const scanned = result?.result as Scan | undefined;

    if (!scanned) {
      throw new Error("no answer");
    }

    // The likely ones ticked, the first time each is seen.
    const before = new Set(state.scan?.found.map((f) => f.id) ?? []);

    for (const found of scanned.found) {
      if (!before.has(found.id) && found.score >= tickedFrom) {
        state.ticked.add(found.id);
      }
    }

    state.scan = scanned;
  } catch {
    state.scan = null;
    state.scanError = "Chrome doesn't let extensions look at this page.";
  }

  render();
}

// ——— Sending ———

/** Sends one receipt, keeping its status; a token that's stopped working disconnects. */
async function sendOne(id: string, getFile: () => Promise<Got>) {
  const current = state.connection;

  if (!current) {
    return;
  }

  state.status.set(id, { state: "sending" });
  render();

  try {
    const file = await getFile();
    const sent = await sendDocument(current, file);

    state.status.set(id, { state: "sent", ...sent });
    state.ticked.delete(id);
  } catch (e) {
    if (signedOut(e)) {
      await forget();
      state.status.set(id, { state: "failed", message: "Signed out: connect again" });
    } else {
      state.status.set(id, { state: "failed", message: e instanceof Error ? e.message : "Couldn't send it" });
    }
  }

  render();
}

async function sendTicked() {
  const tabId = state.tabId;
  const ticked = (state.scan?.found ?? []).filter((f) => state.ticked.has(f.id));

  if (tabId === null) {
    return;
  }

  // One after another: a site that hands out invoices one at a time isn't asked for ten at once.
  for (const found of ticked) {
    await sendOne(found.id, () => get(tabId, found));
  }
}

async function sendWholePage() {
  const tab = await activeTab();

  if (!tab?.id || !tab.url) {
    return;
  }

  const found: Found = {
    id: `page:${tab.url}`,
    kind: "page",
    url: tab.url,
    label: tab.title ?? new URL(tab.url).host,
    context: "This page",
    amount: null,
    date: null,
    score: 0,
  };

  const tabId = tab.id;

  state.extras.unshift({ id: found.id, label: found.label, kind: "page" });
  await sendOne(found.id, () => get(tabId, found));
}

/** From the right-click menu: each waiting one, once. */
async function sendPending() {
  for (const { tabId, found } of await take()) {
    const id = `${found.id}#${Date.now()}`;

    state.extras.unshift({ id, label: found.label, kind: found.kind });
    await sendOne(id, () => get(tabId, found));
  }
}

async function sendFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const id = `dropped:${file.name}:${file.size}:${Date.now()}`;

    state.extras.unshift({ id, label: file.name, kind: "dropped" });

    await sendOne(id, async () => ({
      name: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }));
  }
}

// ——— Connecting ———

async function loadConnection() {
  state.connection = await connection();
  render();

  if (!state.connection) {
    return;
  }

  // Still good? One signed out in Settings → Account shows as not connected.
  try {
    await whoAmI(state.connection);
  } catch (e) {
    if (signedOut(e)) {
      await forget();
    }
  }
}

function setUpConnect() {
  for (const server of servers) {
    const option = document.createElement("option");

    option.value = server.origin;
    option.textContent = `${server.name} (${new URL(server.origin).host})`;
    ui.server.append(option);
  }

  ui.connectButton.addEventListener("click", () => {
    void chrome.tabs.create({ url: connectUrl(ui.server.value) });

    ui.connectNote.hidden = false;
    ui.connectNote.textContent = "Connect in the tab that opened. This panel updates when it's done.";
  });

  ui.disconnect.addEventListener("click", async () => {
    if (state.connection) {
      await disconnect(state.connection);
    }

    await forget();
  });
}

function setUpDrop() {
  ui.files.addEventListener("change", () => {
    if (ui.files.files) {
      void sendFiles(ui.files.files);
    }

    ui.files.value = "";
  });

  // The whole panel takes a drop; the drop zone shows it's coming.
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    ui.drop.classList.add("over");
  });

  document.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) {
      ui.drop.classList.remove("over");
    }
  });

  document.addEventListener("drop", (e) => {
    e.preventDefault();
    ui.drop.classList.remove("over");

    if (e.dataTransfer?.files.length && state.connection) {
      void sendFiles(e.dataTransfer.files);
    }
  });
}

function setUp() {
  setUpConnect();
  setUpDrop();

  ui.rescan.addEventListener("click", () => void scan());
  ui.send.addEventListener("click", () => void sendTicked());
  ui.sendPage.addEventListener("click", () => void sendWholePage());

  chrome.tabs.onActivated.addListener(() => void scan());

  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (tabId === state.tabId && change.status === "complete") {
      void scan();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && isConnectionChange(changes)) {
      void loadConnection().then(scan);
    }

    if (area === "session" && isPendingChange(changes) && state.connection) {
      void sendPending();
    }
  });
}

setUp();

void loadConnection().then(async () => {
  await scan();

  if (state.connection) {
    await sendPending();
  }
});

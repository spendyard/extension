// The side panel: how many receipts the page in the active tab has
// (detect.ts, and the invoice pages and billing APIs it points to), and on a
// click the list, the likely ones ticked, to download to the Downloads folder or
// upload to Spendyard; receipts sent from the right-click menu (pending.ts) or
// dropped on it; and connecting to Spendyard, which only uploading needs.

import { disconnect, sendDocument, signedOut, whoAmI } from "./api";
import { connection, connectUrl, forget, isConnectionChange, servers, type Connection } from "./connection";
import { get, type Got } from "./fetch";
import { follow, mostFollowed } from "./follow";
import { stripeInvoices } from "./stripe";
import { likely, ticksByDefault, type Found, type Scan } from "./found";
import { isPendingChange, take } from "./pending";

type Status =
  | { state: "sending" }
  | { state: "sent"; documentId: string; seen: boolean }
  | { state: "saving" }
  | { state: "saved" }
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
  /** Invoice pages being opened (follow.ts) and billing APIs being read (stripe.ts), for their PDFs. */
  following: 0,
  /** The count first; the list once it's asked for. */
  view: "summary" as "summary" | "list",
  /** Connecting, asked for, or by Upload while not connected. */
  connecting: false,
};

/** Each invoice page opened, by its URL: its PDF, or null when it had none. Kept while the panel is open. */
const followed = new Map<string, Found | null>();
const opening = new Set<string>();

/** Each billing API read, by its URL: the invoices in it. Kept while the panel is open. */
const read = new Map<string, Found[]>();
const reading = new Set<string>();

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  rescan: element<HTMLButtonElement>("rescan"),
  connect: element<HTMLElement>("connect"),
  server: element<HTMLSelectElement>("server"),
  connectButton: element<HTMLButtonElement>("connect-button"),
  connectNote: element<HTMLElement>("connect-note"),
  openConnect: element<HTMLButtonElement>("open-connect"),
  closeConnect: element<HTMLButtonElement>("close-connect"),
  who: element<HTMLElement>("who"),
  disconnect: element<HTMLButtonElement>("disconnect"),
  main: element<HTMLElement>("main"),
  summary: element<HTMLElement>("summary"),
  show: element<HTMLButtonElement>("show"),
  count: element<HTMLElement>("count"),
  countLabel: element<HTMLElement>("count-label"),
  countTicked: element<HTMLElement>("count-ticked"),
  still: element<HTMLElement>("still"),
  found: element<HTMLElement>("found"),
  back: element<HTMLButtonElement>("back"),
  tickAll: element<HTMLButtonElement>("tick-all"),
  tickNone: element<HTMLButtonElement>("tick-none"),
  actions: element<HTMLElement>("actions"),
  download: element<HTMLButtonElement>("download"),
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

  if (status.state === "saving") {
    return make("div", "status", "Downloading…");
  }

  if (status.state === "saved") {
    return make("div", "status saved", "Saved to Downloads");
  }

  const line = make("div", "status sent", status.seen ? "Already in Spendyard · " : "Sent · ");
  const link = make("a", "", "Open");

  link.href = `${state.connection?.server}/documents/${status.documentId}`;
  link.target = "_blank";
  line.append(link);

  return line;
}

const kindWords: Record<string, string> = { file: "PDF", page: "Page", dropped: "Dropped" };

function foundItem(found: Found): HTMLLIElement {
  const item = make("li", "item");
  const box = document.createElement("input");
  const status = state.status.get(found.id);

  box.type = "checkbox";
  box.checked = state.ticked.has(found.id);
  box.disabled = status?.state === "sending" || status?.state === "sent" || status?.state === "saving";
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

/** Ticked, and not on its way already. */
function waiting(busy: Status["state"][]): string[] {
  return [...state.ticked].filter((id) => {
    const status = state.status.get(id)?.state;

    return !status || !busy.includes(status);
  });
}

function renderFooter() {
  const toUpload = waiting(["sending", "sent", "saving"]);
  const toDownload = waiting(["sending", "saving"]);
  const many = (n: number) => (n > 1 ? ` ${n}` : "");

  ui.actions.hidden = state.view !== "list" || state.connecting;

  ui.download.disabled = toDownload.length === 0;
  ui.download.textContent = `Download${many(toDownload.length)}`;

  // Not connected: Upload asks to connect first; downloading needs no one.
  ui.send.disabled = toUpload.length === 0;
  ui.send.textContent = state.connection ? `Upload${many(toUpload.length)}` : "Connect to upload";

  // The page itself, for when it is a receipt the detection missed.
  ui.sendPage.hidden = !state.connection || !state.scan || state.scanError !== null;
}

/** What the badge was last told, so it isn't told again on every render. */
let toldBadge = "";

/** The toolbar's badge, in step with what the panel found: the invoice pages and billing APIs included. */
function tellBadge() {
  if (state.tabId === null || !state.scan) {
    return;
  }

  const message = { type: "spendyard.panel-count", tabId: state.tabId, url: state.scan.url, found: state.scan.found.filter(likely).length };
  const now = JSON.stringify(message);

  if (now !== toldBadge) {
    toldBadge = now;
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function render() {
  const connected = state.connection !== null;

  ui.who.textContent = connected ? `${state.connection!.org.name} · ${state.connection!.email}` : "Not connected to Spendyard";
  ui.disconnect.hidden = !connected;
  ui.openConnect.hidden = connected || state.connecting;

  ui.connect.hidden = connected || !state.connecting;
  ui.main.hidden = state.connecting && !connected;

  ui.sent.replaceChildren(...state.extras.map(extraItem));

  const found = state.scan?.found ?? [];
  const looking = !state.scan || state.following > 0;
  const where = state.scan ? new URL(state.scan.url).host : "";

  // First the count, live as invoice pages and billing APIs answer; the list on a click.
  ui.summary.hidden = state.view !== "summary";
  ui.found.hidden = state.view !== "list";

  ui.where.textContent = where;
  // The count is of the likely ones, as the badge's; the list has the others too.
  const receipts = found.filter(likely).length;
  const others = found.length - receipts;

  ui.show.hidden = found.length === 0;
  ui.count.textContent = String(receipts);
  ui.countLabel.textContent = `${receipts === 1 ? "receipt" : "receipts"} found on this page`;
  ui.countTicked.textContent = [
    `${state.ticked.size} ticked, from the last 12 months`,
    others > 0 ? `and ${plural(others, "other PDF", "other PDFs")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  ui.still.hidden = !(state.scan && state.following > 0);

  ui.empty.hidden = found.length > 0 && !state.scanError;
  ui.empty.textContent = state.scanError ?? (looking ? "Looking for receipts…" : "No receipts found on this page.");

  ui.list.replaceChildren(...found.map(foundItem));
  ui.drop.hidden = !connected;

  tellBadge();

  renderFooter();
}

// ——— Scanning the active tab ———

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  return tab;
}

/** A scan under way, and whether another was asked for meanwhile: one after it, not two at once. */
let scanning = false;
let scanAgain = false;

async function scan() {
  if (scanning) {
    scanAgain = true;

    return;
  }

  scanning = true;

  try {
    await scanOnce();
  } finally {
    scanning = false;
  }

  if (scanAgain) {
    scanAgain = false;
    await scan();
  }
}

async function scanOnce() {
  const tab = await activeTab();

  if (!tab?.id) {
    return;
  }

  const sameTab = tab.id === state.tabId && state.scan?.url === tab.url;

  state.tabId = tab.id;
  state.scanError = null;

  // Another page: its count first.
  if (!sameTab) {
    state.scan = null;
    state.ticked.clear();
    state.view = "summary";
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

    // With the PDFs already taken from its invoice pages; the likely ones ticked, the first time each is seen.
    const merged = withFollowed(scanned);
    const before = new Set(state.scan?.found.map((f) => f.id) ?? []);

    for (const found of merged.found) {
      if (!before.has(found.id) && ticksByDefault(found)) {
        state.ticked.add(found.id);
      }
    }

    state.scan = merged;
    void followAll(scanned);
    void readAll(tab.id, scanned);
  } catch {
    state.scan = null;
    state.scanError = "Chrome doesn't let extensions look at this page.";
  }

  render();
}

/** The scan with the PDFs already taken from its invoice pages and billing APIs. */
function withFollowed(scanned: Scan): Scan {
  const have = new Set(scanned.found.map((f) => f.id));
  const fromPages = scanned.follow.map((page) => followed.get(page.url));
  const fromApis = scanned.read.flatMap((api) => read.get(api.url) ?? []);
  const taken = [...fromPages, ...fromApis].filter((f): f is Found => Boolean(f) && !have.has(f!.id));

  return { ...scanned, found: [...scanned.found, ...taken] };
}

/**
 * Reads the billing APIs a rule points to, in the tab, as the page would (its cookies, its origin), each once, and
 * lists the Stripe invoices in them, the paid ones ticked. A GET, never anything else.
 */
async function readAll(tabId: number, scanned: Scan) {
  const waiting = scanned.read.filter((api) => !read.has(api.url) && !reading.has(api.url));

  for (const api of waiting) {
    reading.add(api.url);
    state.following += 1;
    render();

    const [result] = await chrome.scripting
      .executeScript({
        target: { tabId },
        args: [api.url],
        // Asking for JSON; Miro's answers 415 to a GET that doesn't say it is JSON, so then once more saying so.
        func: async (url: string) => {
          const get = (headers: Record<string, string>) => fetch(url, { credentials: "include", headers });

          let response = await get({ Accept: "application/json" });

          if (response.status === 415) {
            response = await get({ Accept: "application/json", "Content-Type": "application/json" });
          }

          return response.ok ? await response.text() : null;
        },
      })
      .catch(() => [undefined]);

    let invoices: Found[] = [];

    try {
      const text = result?.result;

      invoices = typeof text === "string" ? stripeInvoices(JSON.parse(text), api.vendor) : [];
    } catch {
      invoices = [];
    }

    read.set(api.url, invoices);
    reading.delete(api.url);
    state.following -= 1;

    if (state.scan?.url === scanned.url) {
      const fromElsewhere = new Set([...followed.values(), ...[...read.values()].flat()].map((f) => f?.id));
      const own = state.scan.found.filter((f) => !fromElsewhere.has(f.id));

      state.scan = withFollowed({ ...state.scan, found: own });
      invoices.filter((f) => ticksByDefault(f)).forEach((f) => state.ticked.add(f.id));
    }

    render();
  }
}

/** Opens the invoice pages a rule points to, two at a time, each once, adding each PDF as it comes. */
async function followAll(scanned: Scan) {
  const waiting = scanned.follow.filter((page) => !followed.has(page.url) && !opening.has(page.url)).slice(0, mostFollowed);

  waiting.forEach((page) => opening.add(page.url));
  state.following += waiting.length;
  render();

  const next = async (): Promise<void> => {
    const page = waiting.shift();

    if (!page) {
      return;
    }

    const pdf = await follow(page).catch(() => null);

    followed.set(page.url, pdf);
    opening.delete(page.url);
    state.following -= 1;

    // Still the page it was found on: listed in the list's own order, whichever page answered first, and ticked.
    if (pdf && state.scan?.url === scanned.url && !state.scan.found.some((f) => f.id === pdf.id)) {
      const fromElsewhere = new Set([...followed.values(), ...[...read.values()].flat()].map((f) => f?.id));
      const own = state.scan.found.filter((f) => !fromElsewhere.has(f.id));

      state.scan = withFollowed({ ...state.scan, found: own });

      if (ticksByDefault(pdf)) {
        state.ticked.add(pdf.id);
      }
    }

    render();

    return next();
  };

  await Promise.all([next(), next()]);
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

  // Uploading is what needs Spendyard: connect first, the ticks kept.
  if (!state.connection) {
    state.connecting = true;
    render();

    return;
  }

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

/**
 * Saves the ticked ones to the Downloads folder, one after another, by the name the upload would give them. Fetched
 * as for an upload (fetch.ts), so a sign-in page or something that isn't a receipt fails here too.
 */
async function downloadTicked() {
  const tabId = state.tabId;
  const ticked = (state.scan?.found ?? []).filter((f) => state.ticked.has(f.id) && state.status.get(f.id)?.state !== "saving");

  if (tabId === null) {
    return;
  }

  for (const found of ticked) {
    state.status.set(found.id, { state: "saving" });
    render();

    try {
      const file = await get(tabId, found);
      const blob = URL.createObjectURL(new Blob([file.bytes], { type: file.contentType }));

      try {
        await chrome.downloads.download({ url: blob, filename: file.name, conflictAction: "uniquify", saveAs: false });
      } finally {
        // The download has its own copy once it's started.
        setTimeout(() => URL.revokeObjectURL(blob), 60_000);
      }

      state.status.set(found.id, { state: "saved" });
    } catch (e) {
      state.status.set(found.id, { state: "failed", message: e instanceof Error ? e.message : "Couldn't download it" });
    }

    render();
  }
}

// ——— Connecting ———

async function loadConnection() {
  state.connection = await connection();

  if (state.connection) {
    state.connecting = false;
  }

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

  ui.openConnect.addEventListener("click", () => {
    state.connecting = true;
    render();
  });

  ui.closeConnect.addEventListener("click", () => {
    state.connecting = false;
    render();
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
  ui.download.addEventListener("click", () => void downloadTicked());

  ui.show.addEventListener("click", () => {
    state.view = "list";
    render();
  });

  ui.back.addEventListener("click", () => {
    state.view = "summary";
    render();
  });

  ui.tickAll.addEventListener("click", () => {
    (state.scan?.found ?? []).forEach((f) => state.ticked.add(f.id));
    render();
  });

  ui.tickNone.addEventListener("click", () => {
    state.ticked.clear();
    render();
  });
  ui.sendPage.addEventListener("click", () => void sendWholePage());

  chrome.tabs.onActivated.addListener(() => void scan());

  // The page changed under the panel: a billing list drawn after the page loaded (Vercel's, Miro's), or another
  // page of an app that never reloads. Its count (watch.ts) says so, as it does to the badge: look again.
  chrome.runtime.onMessage.addListener((message: { type?: string }, sender) => {
    if (message?.type === "spendyard.count" && sender.tab?.id !== undefined && sender.tab.id === state.tabId) {
      void scan();
    }

    return false;
  });

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

// Run in the page (chrome.scripting, the extension's own isolated world) when
// the panel scans it: finds the receipts it links to or shows, and whether the
// page is a receipt itself, such as an order confirmation. It only reads the
// page. The panel then calls spendyardScan() and, to send the page itself,
// spendyardSnapshot().
//
// Each receipt gets a score from what's said about it: its link's text and
// file name, the words, amounts and dates around it. Nothing here is certain,
// so the panel shows everything above a low bar and ticks the likely ones.

import { looksLikeId, type Found, type Scan } from "./found";

/** "Receipt" and "invoice" in the languages Spendyard's customers write in. */
const receiptWords =
  /\b(receipts?|invoices?|bills?|statements?|kvittering(?:er)?|faktura(?:er)?|kvitto|quittung|rechnung(?:en)?|re[çc]us?|factures?|recibos?|facturas?|ricevut[ae]|fattur[ae])\b/i;

/** What a link to a file usually says. */
const downloadWords = /\b(download|pdf|view|print|last ned|skriv ut|vis|herunterladen|télécharger)\b/i;

/** A page that is a receipt says so near the top. */
const confirmationWords =
  /\b(order confirmation|thank you for your (order|purchase)|payment (received|confirmation|successful)|your receipt|ordrebekreftelse|takk for (din )?bestilling|kvittering for)\b/i;

/** A total, followed by a number. */
const totalLine =
  /\b(total|grand total|amount (due|paid|charged)|sum|totalt|betale|beløp|gesamt|montant)\b[^\n\d]{0,30}\d/i;

const currency = String.raw`(?:[$€£¥]|\b(?:USD|EUR|GBP|NOK|SEK|DKK|CHF|kr\.?|,-))`;
const number = String.raw`\d[\d\s.,']*\d|\d`;
const amountPattern = new RegExp(`${currency}\\s?(?:${number})|(?:${number})\\s?${currency}`, "i");

const months = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mai|okt|des|mär|dez";
const datePattern = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b`,
    `\\b(?:${months})[a-zé]*\\.? \\d{1,2},? \\d{4}\\b`,
    `\\b\\d{1,2}\\.? (?:${months})[a-zé]*\\.? \\d{4}\\b`,
  ].join("|"),
  "i",
);

/** The most a label or context line holds. */
const shortText = 140;

/** Files that can be receipts, by their URL. */
const pdfUrl = /\.pdf(?:$|[?#])/i;
const imageUrl = /\.(?:png|jpe?g|gif|webp)(?:$|[?#])/i;

function squeeze(text: string, length = shortText): string {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function amountIn(text: string): string | null {
  return text.match(amountPattern)?.[0].trim() ?? null;
}

function dateIn(text: string): string | null {
  return text.match(datePattern)?.[0] ?? null;
}

/** An element's text with a space between its pieces: a row's cells read "Nov 3, 2026 Pro plan", not "2026Pro". */
function textOf(element: Element): string {
  const pieces: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    pieces.push(node.nodeValue ?? "");
  }

  return pieces.join(" ");
}

/** The most text a link's surroundings may have before they're the page rather than its row. */
const aroundAtMost = 400;

/** The text a link sits in: its table row or list item, or a few levels up when it's in neither, short of the page. */
function contextOf(element: Element): string {
  const row = element.closest("tr, li, [role=row], article");

  if (row) {
    return textOf(row);
  }

  let around: Element = element;

  for (let level = 0; level < 3 && around.parentElement; level++) {
    const parent = around.parentElement;

    if (textOf(parent).length > aroundAtMost || parent === document.body) {
      break;
    }

    around = parent;
  }

  return textOf(around);
}

/** The file's own name from its URL, or "" when it has none. */
function fileNameOf(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";

  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function absolute(href: string): URL | null {
  try {
    const url = new URL(href, document.baseURI);

    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** A link scored: a PDF or the words "receipt" or "invoice" on it count most; an amount and a date beside it, a little. */
function scoreLink(link: HTMLAnchorElement, url: URL): Found | null {
  const text = squeeze(link.textContent || link.getAttribute("aria-label") || link.title || "");
  const name = fileNameOf(url);
  const said = `${text} ${name} ${url.pathname} ${url.search}`;
  const context = squeeze(contextOf(link));

  const isPdf = pdfUrl.test(url.href);
  const isImage = imageUrl.test(url.href);
  const namesReceipt = receiptWords.test(said);
  const contextNamesReceipt = receiptWords.test(context);

  // Only a file, or something that calls itself a receipt, is worth a look.
  if (!isPdf && !isImage && !namesReceipt) {
    return null;
  }

  let score = 0;

  if (isPdf) {
    score += 3;
  }

  if (isImage) {
    score += 1;
  }

  if (namesReceipt) {
    score += 3;
  }

  if (contextNamesReceipt) {
    score += 1;
  }

  const offersFile = link.hasAttribute("download") || downloadWords.test(text);

  if (offersFile) {
    score += 1;
  }

  const amount = amountIn(context);
  const date = dateIn(context);

  // A link that only says "Invoices", with no amount or date beside it, is the menu, not one of them.
  if (!isPdf && !isImage && !offersFile && !amount && !date) {
    return null;
  }

  if (amount) {
    score += 1;
  }

  if (date) {
    score += 1;
  }

  // "View invoice" says more than "in_123"; "invoice-2026-11.pdf" more than "Download".
  const namedFile = /\.\w{2,4}$/.test(name) && !looksLikeId(name);
  const plainName = !looksLikeId(name) && name;
  const label = (receiptWords.test(text) && text) || (namedFile && name) || (!downloadWords.test(text) && text) || plainName || text || url.hostname;

  return {
    id: url.href,
    kind: "file",
    url: url.href,
    label,
    context: context === text ? "" : context,
    amount,
    date,
    score,
  };
}

/** PDFs shown in the page (embed, object, iframe): almost always the document the page is about. */
function embeddedPdfs(): Found[] {
  const found: Found[] = [];
  const frames = document.querySelectorAll<HTMLElement>("embed, object, iframe");

  for (const frame of frames) {
    const source = frame.getAttribute("src") ?? frame.getAttribute("data") ?? "";
    const type = frame.getAttribute("type") ?? "";
    const url = absolute(source);

    if (!url || !(pdfUrl.test(url.href) || type === "application/pdf")) {
      continue;
    }

    found.push({
      id: url.href,
      kind: "file",
      url: url.href,
      label: fileNameOf(url) || document.title,
      context: "",
      amount: null,
      date: null,
      score: 6,
    });
  }

  return found;
}

/** Large pictures said to be receipts: a photo of one, or a scan. */
function receiptImages(): Found[] {
  const found: Found[] = [];

  for (const image of document.querySelectorAll("img")) {
    const url = absolute(image.currentSrc || image.src);
    const said = `${image.alt} ${image.title} ${url?.pathname ?? ""}`;
    const bigEnough = image.naturalWidth >= 300 && image.naturalHeight >= 300;

    if (!url || !bigEnough || !receiptWords.test(said)) {
      continue;
    }

    found.push({
      id: url.href,
      kind: "file",
      url: url.href,
      label: squeeze(image.alt) || fileNameOf(url),
      context: "",
      amount: null,
      date: null,
      score: 4,
    });
  }

  return found;
}

/** The page as a receipt: a title or heading that says so, a total, amounts and a date. Null when it doesn't look like one. */
function pageItself(): Found | null {
  const headings = Array.from(document.querySelectorAll("h1, h2"), (h) => h.textContent ?? "").join(" ");
  const top = `${document.title} ${headings}`;
  const text = document.body?.innerText ?? "";

  let score = 0;

  if (receiptWords.test(top)) {
    score += 3;
  }

  if (confirmationWords.test(top) || confirmationWords.test(text.slice(0, 3000))) {
    score += 3;
  }

  if (totalLine.test(text)) {
    score += 2;
  }

  const amounts = text.match(new RegExp(amountPattern.source, "gi")) ?? [];
  const date = dateIn(text);

  if (amounts.length >= 2) {
    score += 1;
  }

  if (date) {
    score += 1;
  }

  // A total and some amounts alone are any shop's cart: it has to say it's a receipt.
  if (score < 5) {
    return null;
  }

  const total = text.match(totalLine);
  const amount = total ? amountIn(text.slice(total.index, (total.index ?? 0) + 80)) : (amounts[0] ?? null);

  return {
    id: `page:${location.href}`,
    kind: "page",
    url: location.href,
    label: squeeze(document.title) || location.hostname,
    context: "This page",
    amount,
    date,
    score,
  };
}

/** The tab shows a PDF or an image itself, not a page. */
function shownFile(): Found | null {
  const type = document.contentType;

  if (type !== "application/pdf" && !type.startsWith("image/")) {
    return null;
  }

  const url = new URL(location.href);

  return {
    id: url.href,
    kind: "file",
    url: url.href,
    label: fileNameOf(url) || url.hostname,
    context: "Open in this tab",
    amount: null,
    date: null,
    score: 6,
  };
}

/** The bar for showing a link at all. */
const shownFrom = 3;

function scan(): Scan {
  const found = new Map<string, Found>();

  const keep = (item: Found) => {
    const before = found.get(item.id);

    if (!before || before.score < item.score) {
      found.set(item.id, item);
    }
  };

  const file = shownFile();

  if (file) {
    keep(file);
  } else {
    const page = pageItself();

    if (page) {
      keep(page);
    }

    embeddedPdfs().forEach(keep);
    receiptImages().forEach(keep);

    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const url = absolute(link.getAttribute("href") ?? "");
      const item = url && scoreLink(link, url);

      if (item && item.score >= shownFrom) {
        keep(item);
      }
    }
  }

  const ranked = [...found.values()].sort((a, b) => b.score - a.score);

  return { url: location.href, title: document.title, found: ranked };
}

/** The page as it is now, as one HTML file for the reader: no scripts, and links that still lead where they did. */
function snapshot(): string {
  const copy = document.documentElement.cloneNode(true) as HTMLElement;

  copy.querySelectorAll("script, noscript, iframe, template, link[rel=preload], link[rel=modulepreload]").forEach((e) => e.remove());

  const head = copy.querySelector("head") ?? copy.insertBefore(document.createElement("head"), copy.firstChild);
  const base = document.createElement("base");
  const source = document.createElement("meta");

  base.href = document.baseURI;
  source.name = "spendyard-source";
  source.content = location.href;

  head.prepend(base, source);

  return `<!DOCTYPE html>\n${copy.outerHTML}`;
}

Object.assign(globalThis, {
  spendyardScan: scan,
  spendyardSnapshot: snapshot,
});

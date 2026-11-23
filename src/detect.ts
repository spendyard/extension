// Run in the page (chrome.scripting, the extension's own isolated world) when
// the panel scans it: finds the PDFs it links to or shows, and the PDF the tab
// shows itself. Only PDFs: never the page, a page it links to, or an image;
// those are sent by hand (the panel's Send this page, the right-click menu).
// It only reads the page. The panel then calls spendyardScan() and, to send
// the page by hand, spendyardSnapshot().
//
// Each PDF gets a score from what's said about it: its link's text and file
// name, the words, amounts and dates around it. Nothing here is certain, so
// the panel shows everything above a low bar and ticks the likely ones.

import { looksLikeId, type Found, type Scan, type ToFollow, type ToRead } from "./found";
import { matches, ruleFor, type SiteRule } from "./sites";

/** "Receipt" and "invoice" in the languages Spendyard's customers write in. */
const receiptWords =
  /\b(receipts?|invoices?|bills?|statements?|kvittering(?:er)?|faktura(?:er)?|kvitto|quittung|rechnung(?:en)?|re[çc]us?|factures?|recibos?|facturas?|ricevut[ae]|fattur[ae])\b/i;

/** What a link to a file usually says. */
const downloadWords = /\b(download|pdf|view|print|last ned|skriv ut|vis|herunterladen|télécharger)\b/i;

const currency = String.raw`(?:[$€£¥]|\b(?:USD|EUR|GBP|NOK|SEK|DKK|CHF|kr\.?|,-))`;
const number = String.raw`\d[\d\s.,']*\d|\d`;
// A currency after a number only when no number follows it: "ending in 3776 $19.00" is $19.00, not "3776 $".
const amountPattern = new RegExp(`${currency}\\s?(?:${number})|(?:${number})\\s?${currency}(?!\\s?\\d)`, "i");

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

/**
 * A PDF, by its URL: a name ending .pdf, or a path ending /pdf, as Stripe's hosted invoices
 * (pay.stripe.com/invoice/…/pdf, behind Vercel's and many others' Download) have it.
 */
const pdfUrl = /(?:\.|\/)pdf\/?(?:$|[?#])/i;

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

/** A link to a PDF: its URL ends in .pdf or /pdf, or the link says it's one (type, or a download name ending .pdf). */
function linksToPdf(link: HTMLAnchorElement, url: URL): boolean {
  const type = (link.getAttribute("type") ?? "").toLowerCase();
  const downloadName = link.getAttribute("download") ?? "";

  return pdfUrl.test(url.href) || type === "application/pdf" || /\.pdf$/i.test(downloadName);
}

/** A link's name: its text, or for an icon its aria-label, the element that labels it, its title or its tooltip. */
function nameOf(link: HTMLAnchorElement): string {
  const labelledBy = (link.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id)?.textContent ?? "" : ""))
    .join(" ");
  const tooltip = link.id ? document.querySelector(`tool-tip[for="${CSS.escape(link.id)}"]`)?.textContent ?? "" : "";

  return [link.textContent, link.getAttribute("aria-label"), labelledBy, link.title, tooltip].map((t) => t?.trim() ?? "").find(Boolean) ?? "";
}

/** A link to a PDF scored: the words "receipt" or "invoice" on it count most; an amount and a date beside it, a little. */
function scoreLink(link: HTMLAnchorElement, url: URL, rule: SiteRule | null): Found | null {
  // A site's rule knows its receipts and invoices: those are ticked, whatever they say.
  const ruleReceipt = matches(rule?.receipts, url.pathname);
  const ruleInvoice = matches(rule?.invoices, url.pathname);

  // Only PDFs: a link to a page, even one that calls itself an invoice, is left to be sent by hand.
  if (!linksToPdf(link, url) && !ruleReceipt && !ruleInvoice) {
    return null;
  }

  const text = squeeze(nameOf(link));
  const name = fileNameOf(url);
  const said = `${text} ${name} ${url.pathname} ${url.search}`;
  const context = squeeze(contextOf(link));

  const namesReceipt = receiptWords.test(said);
  const contextNamesReceipt = receiptWords.test(context);

  let score = 3;

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

  if (amount) {
    score += 1;
  }

  if (date) {
    score += 1;
  }

  if (ruleReceipt || ruleInvoice) {
    score = Math.max(score, 8);
  }

  // "View invoice" says more than "in_123"; "invoice-2026-11.pdf" more than "Download".
  // A path ending /pdf (Stripe's) has no name of its own: "pdf" says nothing.
  const namedFile = /\.\w{2,4}$/.test(name) && !looksLikeId(name);
  const plainName = !looksLikeId(name) && name.toLowerCase() !== "pdf" && name;
  const titleNamesReceipt = receiptWords.test(document.title) && squeeze(document.title);
  // A rule's receipt is named by its vendor: GitHub's icons say View receipt even on the PDF.
  const ruleLabel = rule && (ruleReceipt ? `${rule.name} receipt` : ruleInvoice ? `${rule.name} invoice` : "");
  const label =
    ruleLabel ||
    (receiptWords.test(text) && text) ||
    (namedFile && name) ||
    (!downloadWords.test(text) && text) ||
    plainName ||
    titleNamesReceipt ||
    text ||
    `Receipt from ${url.hostname}`;

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

/** The tab shows a PDF itself, not a page. */
function shownFile(): Found | null {
  if (document.contentType !== "application/pdf") {
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

/** A PDF link found, with its row and whether it is a receipt (by a rule, or by what it says). */
interface Linked {
  row: Element | null;
  receipt: boolean;
  item: Found;
}

/** Under the panel's bar for ticking (5): shown, not ticked. */
const shownNotTicked = 4;

/** Says it's a receipt, not an invoice: what was paid, rather than what was asked for. */
const paidWords = /\b(receipts?|kvittering(?:er)?|kvitto|quittung|re[çc]us?|recibos?|ricevut[ae])\b/i;

/**
 * One row (a payment in a billing table) with more than one PDF, such as a receipt and an invoice: the receipt is
 * ticked, the others shown but not ticked, so one payment isn't sent twice.
 */
function receiptFirst(links: Linked[]) {
  const byRow = new Map<Element, Linked[]>();

  for (const link of links) {
    if (link.row) {
      byRow.set(link.row, [...(byRow.get(link.row) ?? []), link]);
    }
  }

  for (const inRow of byRow.values()) {
    const receipt = inRow.find((l) => l.receipt);

    if (inRow.length < 2 || !receipt) {
      continue;
    }

    for (const other of inRow) {
      if (other !== receipt) {
        other.item.score = Math.min(other.item.score, shownNotTicked);
      }
    }
  }
}

/** The rows of a billing list that link to their invoice's own page, for a rule that says to open them. */
function toFollow(rule: SiteRule | null): ToFollow[] {
  const follow = rule?.follow;

  if (!rule || !follow) {
    return [];
  }

  const pages = new Map<string, ToFollow>();

  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = absolute(link.getAttribute("href") ?? "");

    if (!url || url.host !== location.host || !matches(follow.pages, url.pathname) || pages.has(url.href)) {
      continue;
    }

    const context = squeeze(contextOf(link));

    pages.set(url.href, {
      url: url.href,
      pdf: follow.pdf,
      label: `${rule.name} invoice`,
      amount: amountIn(context),
      date: dateIn(context),
    });
  }

  return [...pages.values()];
}

/** The billing API a rule says to read: the call the page made, or the rule's URL filled in from the page's path. */
function toRead(rule: SiteRule | null): ToRead[] {
  const api = rule?.api;

  if (!rule || !api) {
    return [];
  }

  const made = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .find((name) => new RegExp(api.seen).test(name.split(/[?#]/)[0]!));

  if (made) {
    return [{ url: made, vendor: rule.name }];
  }

  const parts = location.pathname.match(new RegExp(rule.pages));
  const url = parts ? api.url.replace(/\$(\d)/g, (_, n: string) => parts[Number(n)] ?? "") : null;

  return url ? [{ url, vendor: rule.name }] : [];
}

function scan(): Scan {
  const found = new Map<string, Found>();
  const rule = ruleFor(new URL(location.href));

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
    embeddedPdfs().forEach(keep);

    const links: Linked[] = [];

    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const url = absolute(link.getAttribute("href") ?? "");
      const item = url && scoreLink(link, url, rule);

      if (!url || !item || item.score < shownFrom || links.some((l) => l.item.id === item.id)) {
        continue;
      }

      const receipt = rule?.receipts ? matches(rule.receipts, url.pathname) : paidWords.test(`${nameOf(link)} ${url.pathname}`);

      links.push({ row: link.closest("tr, li, [role=row]"), receipt, item });
    }

    receiptFirst(links);
    links.forEach((l) => keep(l.item));
  }

  const ranked = [...found.values()].sort((a, b) => b.score - a.score);

  const follow = file ? [] : toFollow(rule);

  const read = file ? [] : toRead(rule);

  return { url: location.href, title: document.title, found: ranked, follow, read };
}

/** The page as it is now, as one HTML file for the reader, when it's sent by hand: no scripts, and links that still lead where they did. */
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

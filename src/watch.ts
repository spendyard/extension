// Run from each page's start (the manifest's content script, in the
// extension's own isolated world). Counts the receipts on a page that looks
// like billing, for the toolbar's badge (background.ts): the same reading as
// the panel's (scan.ts), of the page alone, again as the page changes; only
// the count leaves the page. And remembers the calls the page makes to a
// billing API's list (general.ts), so the scan can read them again later. The
// browser's own list of calls holds 250, and a busy app such as Miro has
// filled it before it asks for its invoices: then it stops telling anyone of
// new calls, so the list is let grow, 250 at a time, up to 2000.
//
// Only a call's URL, and only one whose path ends invoices or receipts; never
// what it sent or got back. Nothing leaves the page: detect.ts reads it when
// the panel scans.

import { billingApi } from "./general";
import { likely } from "./found";
import { scan } from "./scan";

/** The most calls kept for one page. */
const mostKept = 50;

const calls: string[] = [];

Object.assign(globalThis, { spendyardCalls: calls });

function remember(entries: PerformanceEntryList) {
  for (const entry of entries) {
    const { initiatorType } = entry as PerformanceResourceTiming;

    if (initiatorType !== "fetch" && initiatorType !== "xmlhttprequest") {
      continue;
    }

    let path: string;

    try {
      path = new URL(entry.name).pathname;
    } catch {
      continue;
    }

    if (billingApi.test(path) && !calls.includes(entry.name) && calls.length < mostKept) {
      calls.push(entry.name);
      soon();
    }
  }
}

/** How far the browser's list may grow for a busy page, 250 at a time. */
const mostTimed = 2000;

try {
  new PerformanceObserver((list) => remember(list.getEntries())).observe({ type: "resource", buffered: true });

  // A full list tells no one of the calls after it, Miro's invoices among them: room for 250 more, as the browser
  // asks, and the calls it held back come through.
  performance.addEventListener("resourcetimingbufferfull", () => {
    const now = performance.getEntriesByType("resource").length;

    if (now < mostTimed) {
      performance.setResourceTimingBufferSize(now + 250);
    }
  });
} catch {
  // A page without resource timing: the scan still has the browser's own list.
}

// ——— The badge ———

/** Words a billing page says somewhere near the top, in its address, title or headings. */
const billingWords = /billing|invoice|receipt|payment|subscription|faktura|kvittering|rechnung|factur|quittung/i;

/** Read only a page that looks like billing, or links to a PDF or to Stripe: the rest of the web isn't scanned. */
function looksLikeBilling(): boolean {
  if (billingWords.test(location.href) || billingWords.test(document.title) || calls.length > 0) {
    return true;
  }

  const headings = Array.from(document.querySelectorAll("h1, h2"), (h) => h.textContent ?? "").join(" ");

  return billingWords.test(headings) || document.querySelector('a[href*=".pdf" i], a[href*="stripe.com"]') !== null;
}

/** What was last said, so the same count isn't said again. */
let said = "";

/**
 * Counts and says it: the likely receipts' PDFs on the page and the invoice pages its rows link to. A billing API's invoices are only
 * read when the panel opens, so a page with only those says there's more to see.
 */
function count() {
  let found = 0;
  let more = false;

  if (looksLikeBilling()) {
    const scanned = scan();

    // Every row that links to an invoice's page is one: the panel opens it for the PDF.
    found = scanned.found.filter(likely).length + scanned.follow.length;
    more = scanned.read.length > 0;
  }

  const now = JSON.stringify({ url: location.href, found, more });

  if (now === said) {
    return;
  }

  said = now;
  chrome.runtime.sendMessage({ type: "spendyard.count", url: location.href, found, more }).catch(() => undefined);
}

/** A busy page changes all the time: counted a moment after it settles, and at most every 2 seconds. */
const settle = 800;
const atMostEvery = 2000;

let timer: ReturnType<typeof setTimeout> | undefined;
let last = 0;

function soon() {
  clearTimeout(timer);

  const wait = Math.max(settle, last + atMostEvery - Date.now());

  timer = setTimeout(() => {
    last = Date.now();

    try {
      count();
    } catch {
      // A page the scan can't read: no badge.
    }
  }, wait);
}

function start() {
  soon();
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

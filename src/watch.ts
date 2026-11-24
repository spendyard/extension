// Run from each page's start (the manifest's content script, in the
// extension's own isolated world): remembers the calls the page makes to a
// billing API's list (general.ts), so the scan can read them again later. The
// browser's own list of calls holds 250, and a busy app such as Miro has
// filled it before it asks for its invoices: then it stops telling anyone of
// new calls, so the list is let grow, 250 at a time, up to 2000.
//
// Only a call's URL, and only one whose path ends invoices or receipts; never
// what it sent or got back. Nothing leaves the page: detect.ts reads it when
// the panel scans.

import { billingApi } from "./general";

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

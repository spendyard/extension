// Run in the page (chrome.scripting, the extension's own isolated world) when
// the panel scans it (scan.ts does the reading). The panel then calls
// spendyardScan(); to send the page by hand, spendyardSnapshot(); and to have
// a list's older rows, spendyardLoadMore().

import { pressLoadMore, scan, snapshot } from "./scan";

Object.assign(globalThis, {
  spendyardScan: scan,
  spendyardSnapshot: snapshot,
  spendyardLoadMore: pressLoadMore,
});

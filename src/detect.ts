// Run in the page (chrome.scripting, the extension's own isolated world) when
// the panel scans it (scan.ts does the reading). The panel then calls
// spendyardScan() and, to send the page by hand, spendyardSnapshot().

import { scan, snapshot } from "./scan";

Object.assign(globalThis, {
  spendyardScan: scan,
  spendyardSnapshot: snapshot,
});

// What detect.ts finds on a page and hands to the panel.

/** A receipt the page links to or shows (a PDF, an image), or the page itself when it is one. */
export interface Found {
  /** The same for the same receipt on every scan, so the panel keeps what was ticked. */
  id: string;

  kind: "file" | "page";

  /** Where to get it: the file's URL, or the page's own. */
  url: string;

  /** What to call it, from the link's text, the file's name or the page's title. */
  label: string;

  /** The text around it, such as its row in a table of invoices. */
  context: string;

  amount: string | null;
  date: string | null;

  /** How sure the detection is: the panel ticks those at 5 or more. */
  score: number;
}

/** A page scanned, and the receipts found on it. */
export interface Scan {
  url: string;
  title: string;
  found: Found[];
}

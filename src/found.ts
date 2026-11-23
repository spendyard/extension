// What detect.ts finds on a page and hands to the panel, and what the panel and
// the right-click menu send.

/** A PDF the page links to or shows; or, sent by hand, the page itself. */
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

/**
 * Whether a name is only an id: "inv_c3RyaXBlOmluXzFVSUNh…" from a URL says nothing to a person and won't
 * wrap in a list. "invoice-2026-11.pdf" and "View invoice" are names.
 */
export function looksLikeId(name: string): boolean {
  const plain = name.replace(/\.\w{2,4}$/, "");

  return /^[A-Za-z0-9_]{16,}$/.test(plain) || /[A-Za-z0-9]{24,}/.test(plain);
}

/** A page scanned, and the receipts found on it. */
export interface Scan {
  url: string;
  title: string;
  found: Found[];
}

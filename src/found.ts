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

  /** How sure the detection is: the panel ticks those at 5 or more from the last year (ticksByDefault). */
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

/**
 * A row of a billing list that links to its invoice's own page, the PDF only there (a site rule's follow): the
 * panel opens the page and takes the PDF.
 */
export interface ToFollow {
  /** The invoice's page. */
  url: string;

  /** The PDF to take from it, by its URL without its query (the rule's pattern). */
  pdf: string;

  /** What to call it: "Vercel invoice". */
  label: string;

  amount: string | null;
  date: string | null;
}

/** A vendor's billing API to read for its Stripe invoices (a site rule's api): the panel reads it in the page. */
export interface ToRead {
  url: string;
  vendor: string;
}

/** A page scanned, the receipts found on it, the invoice pages to open and the billing APIs to read for theirs. */
export interface Scan {
  url: string;
  title: string;
  found: Found[];
  follow: ToFollow[];
  read: ToRead[];
}

const monthNumbers: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12, dez: 12,
};

/**
 * A date as the scan finds it, read: 2026-11-01, 03.09.2026 (day first), 11/03/2026 (month first unless the first
 * can't be a month), Sep 14, 2026 and 14. sep 2026. Null when it can't be read.
 */
export function dateValue(date: string | null): Date | null {
  if (!date) {
    return null;
  }

  const make = (year: number, month: number, day: number) => {
    const full = year < 100 ? 2000 + year : year;
    const made = new Date(Date.UTC(full, month - 1, day));

    return month >= 1 && month <= 12 && day >= 1 && day <= 31 && !Number.isNaN(made.getTime()) ? made : null;
  };

  const iso = date.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (iso) {
    return make(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dotted = date.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);

  if (dotted) {
    return make(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));
  }

  const slashed = date.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);

  if (slashed) {
    const [a, b] = [Number(slashed[1]), Number(slashed[2])];

    return a > 12 ? make(Number(slashed[3]), b, a) : make(Number(slashed[3]), a, b);
  }

  const named = date.toLowerCase().match(/([a-zé]{3})[a-zé]*\.? (\d{1,2}),? (\d{4})|(\d{1,2})\.? ([a-zé]{3})[a-zé]*\.? (\d{4})/);

  if (named) {
    const month = monthNumbers[named[1] ?? named[5] ?? ""];
    const day = Number(named[2] ?? named[4]);
    const year = Number(named[3] ?? named[6]);

    return month ? make(year, month, day) : null;
  }

  return null;
}

/**
 * Which receipt it is, whichever way it was found: Stripe's PDF by its address without its query (the same invoice
 * comes with another ?s= from a page and from its billing API, as Vercel's do), anything else by its id.
 */
export function receiptKey(found: Found): string {
  try {
    const url = new URL(found.url);

    if (url.hostname === "pay.stripe.com") {
      return `${url.origin}${url.pathname}`;
    }
  } catch {
    // Not an address: its id.
  }

  return found.id;
}

/** Each receipt once, the first of it kept: found on the page, from its invoice pages and from its billing API. */
export function once(found: Found[]): Found[] {
  const seen = new Set<string>();

  return found.filter((f) => {
    const key = receiptKey(f);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

/** Likely a receipt: what the badge and the panel's count count; the panel lists the less likely ones too. */
export const likelyFrom = 5;

export function likely(found: Found): boolean {
  return found.score >= likelyFrom;
}

/** How far back the panel ticks: a first send from a long history is the last year, not everything since 2020. */
export const tickedMonths = 12;

/** The panel's bar for ticking a receipt: likely (detect.ts's score 5 or more), and dated in the last year or not dated. */
export function ticksByDefault(found: Found, now = new Date()): boolean {
  if (!likely(found)) {
    return false;
  }

  const date = dateValue(found.date);

  if (!date) {
    return true;
  }

  const since = new Date(now);

  since.setUTCMonth(since.getUTCMonth() - tickedMonths);

  return date >= since;
}

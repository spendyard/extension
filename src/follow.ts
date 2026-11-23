// Opening an invoice's own page for its PDF, when a site's rule says a billing
// list only links to those pages (sites.ts): fetched as the person, as fetch.ts
// fetches a PDF, read for its links and never shown or sent.

import type { Found, ToFollow } from "./found";

/** The most invoice pages opened for one list: a long history is the newest first, and the rest a Load more away. */
export const mostFollowed = 24;

/** The first link in a page's HTML whose URL, without its query, matches the pattern: as absolute as the page made it. */
export function pdfIn(html: string, base: string, pattern: string): string | null {
  const wanted = new RegExp(pattern, "i");
  const hrefs = html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi);

  for (const [, double, single] of hrefs) {
    const href = (double ?? single ?? "").replace(/&amp;/g, "&");

    let url: URL;

    try {
      url = new URL(href, base);
    } catch {
      continue;
    }

    if (wanted.test(`${url.origin}${url.pathname}`)) {
      return url.href;
    }
  }

  return null;
}

/** An invoice's page opened, and its PDF as the scan would have found it; null when the page has none. */
export async function follow(page: ToFollow): Promise<Found | null> {
  const response = await fetch(page.url, { credentials: "include" });

  if (!response.ok) {
    return null;
  }

  const pdf = pdfIn(await response.text(), response.url, page.pdf);

  if (!pdf) {
    return null;
  }

  return {
    id: pdf,
    kind: "file",
    url: pdf,
    label: page.label,
    context: "From its invoice's page",
    amount: page.amount,
    date: page.date,
    score: 8,
  };
}

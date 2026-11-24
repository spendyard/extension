// Opening an invoice's own page for its PDF, when a billing list only links to
// those pages (a site's rule, or general.ts): fetched as the person, as
// fetch.ts fetches a PDF, read for its links and never shown or sent.

import type { Found, ToFollow } from "./found";
import { stripePdf } from "./general";

/** The most invoice pages opened for one list: a long history is the newest first, and the rest a Load more away. */
export const mostFollowed = 24;

/** How much a PDF on an invoice's page looks like its invoice: Stripe's most, one named so next, any other least. */
function likeness(url: URL): number {
  if (new RegExp(stripePdf).test(`${url.origin}${url.pathname}`)) {
    return 3;
  }

  return /invoice|receipt|faktura|kvittering/i.test(url.pathname) ? 2 : 1;
}

/**
 * The PDF on a page's HTML whose URL, without its query, matches the pattern: from its links, or from the data an app
 * keeps in the page (Stripe's PDF in JSON, its slashes escaped). The likeliest, the first of those; as absolute as the
 * page made it.
 */
export function pdfIn(html: string, base: string, pattern: string): string | null {
  const wanted = new RegExp(pattern, "i");
  const hrefs = [...html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(([, d, s]) => (d ?? s ?? "").replace(/&amp;/g, "&"));
  const inData = [...html.matchAll(/https:(?:\\?\/){2}pay\.stripe\.com(?:\\?\/[^"'\s<>\\]+)+/g)].map(([m]) => m.replace(/\\\//g, "/"));

  let best: URL | null = null;

  for (const href of [...hrefs, ...inData]) {
    let url: URL;

    try {
      url = new URL(href, base);
    } catch {
      continue;
    }

    if (wanted.test(`${url.origin}${url.pathname}`) && (!best || likeness(url) > likeness(best))) {
      best = url;
    }
  }

  return best?.href ?? null;
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

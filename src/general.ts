// What the scan does on a billing page it has no rule for (sites.ts has the
// rules): the patterns SaaS billing shares, learnt on the sites that have
// rules, so a site never tried works the same way.
//
// - Stripe everywhere: its hosted PDF (pay.stripe.com/invoice/…/pdf) is a PDF,
//   its hosted invoice page (invoice.stripe.com/i/…) is opened for that PDF,
//   and its invoices are read from any billing API's answer (stripe.ts).
// - A row with an amount and a date that links to the site's own page for one
//   invoice or receipt: the page is opened for its PDF (follow.ts), as Vercel's.
// - A billing API the page called for its list, its path ending invoices or
//   receipts: read again, only with a GET, for the Stripe invoices in it, as
//   Miro's.

/** Stripe's hosted PDF, whichever site links to it. */
export const stripePdf = "^https://pay\\.stripe\\.com/invoice/.+/pdf$";

/** Stripe's hosted invoice page, whose PDF is on it. */
export const stripeInvoicePage = /^https:\/\/invoice\.stripe\.com\/i\//;

/** Any PDF on a page opened for one, by its URL without its query: the best of them is taken (follow.ts). */
export const anyPdf = "(?:\\.pdf|/pdf)/?$";

/** A site's own page for one invoice or receipt, by its path: a step below a word that says so. */
export const invoicePage = /\/(?:invoices?|receipts?|bills?|billing|kvitteringer|fakturaer?)\/[^/]+/i;

/** A billing API's list, by its path: ending invoices or receipts, or a billing or payment history. */
export const billingApi = /\/(?:invoices|receipts|billing[-_]?history|payment[-_]?history)\/?$/i;

/**
 * A request for the page itself, rendered as data: Next.js's ?_rsc (Vercel's list), Remix's ?_data, SvelteKit's
 * __data.json. Never a billing API: the page has what it has, and each Load more makes another.
 */
export function isPageRender(url: URL): boolean {
  return url.searchParams.has("_rsc") || url.searchParams.has("_data") || /\/__data\.json$|\.rsc$/.test(url.pathname);
}

/** The site a host belongs to, roughly: its last two labels (svc.eu01.miro.com → miro.com). */
export function siteOf(host: string): string {
  return host.toLowerCase().split(".").slice(-2).join(".");
}

/** A vendor's name from its site, for what's found there: vercel.com → Vercel. */
export function vendorOf(host: string): string {
  const name = siteOf(host).split(".")[0] ?? host;

  return name.charAt(0).toUpperCase() + name.slice(1);
}

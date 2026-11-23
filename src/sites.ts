// What the scan knows about particular billing pages, beside what it can tell
// on any page (detect.ts). A rule only adds to the scan or ranks what it
// finds: a site the rules don't know, or one that has changed, still gets the
// general scan.
//
// Rules are data, not code: patterns as strings, so they could one day come
// from Spendyard (with its catalog of vendors) without a new release of the
// extension. Each has a page kept in test/pages to check it against.

export interface SiteRule {
  /** The vendor, as the panel names what a rule finds: "Vercel invoice". */
  name: string;

  /** The sites it's for, a subdomain included: "vercel.com". */
  hosts: string[];

  /** The pages it's for, by path. */
  pages: string;

  /** PDF links that are receipts, by path: ticked, and over an invoice in the same row. */
  receipts?: string;

  /** PDF links that are invoices, by path: ticked unless their row has a receipt. */
  invoices?: string;

  /**
   * A list whose rows link to each invoice's own page, the PDF only there: those pages, by path, and the PDF to
   * take from each, by its URL without its query.
   */
  follow?: { pages: string; pdf: string };
}

export const rules: SiteRule[] = [
  {
    // Each row's Download PDF is a button with nothing behind it; the invoice's own page links to Stripe's PDF.
    name: "Vercel",
    hosts: ["vercel.com"],
    pages: "/invoices$",
    follow: {
      pages: "/invoices/inv_[A-Za-z0-9_]+$",
      pdf: "^https://pay\\.stripe\\.com/invoice/.+/pdf$",
    },
  },
  {
    // Each payment: a receipt as HTML and as a PDF, behind icons, and invoices behind a menu.
    name: "GitHub",
    hosts: ["github.com"],
    pages: "/billing/history$",
    receipts: "/billing/receipt/[^/]+\\.pdf$",
  },
];

/** The rule for a page, if there is one. */
export function ruleFor(url: URL): SiteRule | null {
  const host = url.hostname.toLowerCase();

  return (
    rules.find((rule) => {
      const onHost = rule.hosts.some((h) => host === h || host.endsWith(`.${h}`));

      return onHost && new RegExp(rule.pages).test(url.pathname);
    }) ?? null
  );
}

/** Whether a pattern of a rule matches. An unset one matches nothing. */
export function matches(pattern: string | undefined, text: string): boolean {
  return pattern !== undefined && new RegExp(pattern, "i").test(text);
}

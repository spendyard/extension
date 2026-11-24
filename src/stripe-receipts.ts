// A paid Stripe invoice's receipt, in place of the invoice: the invoice's PDF
// only says what was due, so Spendyard reads it as due; its receipt says it
// was paid, when, and with which card. Stripe's own invoice page has a
// Download receipt for a paid one, and asks invoicedata.stripe.com for it, by
// the invoice's account and token: that answers with the receipt's file, which
// needs no sign-in. An invoice not paid yet has none, and stays the invoice.

/** Where Stripe says a hosted invoice's receipt is, from its PDF's address (pay.stripe.com/invoice/acct_…/live_…/pdf). */
export function receiptLookupOf(invoicePdf: string): string | null {
  let url: URL;

  try {
    url = new URL(invoicePdf);
  } catch {
    return null;
  }

  const [, kind, account, token, last] = url.pathname.split("/");

  if (url.hostname !== "pay.stripe.com" || kind !== "invoice" || !account?.startsWith("acct_") || !token || last !== "pdf") {
    return null;
  }

  return `https://invoicedata.stripe.com/invoice_receipt_file_url/${account}/${token}${url.search}`;
}

/** How long Stripe gets to say where the receipt is, before the invoice is taken as it is. */
const askingFor = 8000;

/** A Stripe invoice's receipt's address, when it's paid and has one; null for any other file, or when Stripe doesn't say. */
export async function stripeReceiptOf(invoicePdf: string): Promise<string | null> {
  const lookup = receiptLookupOf(invoicePdf);

  if (!lookup) {
    return null;
  }

  try {
    const response = await fetch(lookup, { credentials: "omit", signal: AbortSignal.timeout(askingFor) });

    if (!response.ok) {
      return null;
    }

    const said = (await response.json()) as { file_url?: unknown };

    return typeof said.file_url === "string" && /^https:\/\/[a-z.]*stripe\.com\//.test(said.file_url) ? said.file_url : null;
  } catch {
    return null;
  }
}

// Stripe's invoices, as a vendor's own billing API hands them to its page:
// Miro's (and many others') list is Stripe's invoice objects passed along, each
// with its hosted PDF (pay.stripe.com/invoice/…/pdf), its date in seconds, its
// total in the currency's smallest unit and whether it's paid. Read from the
// JSON wherever they sit in it, whatever the vendor renamed the fields.

import type { Found } from "./found";

/** Stripe's hosted invoice PDF. */
const stripePdf = /^https:\/\/pay\.stripe\.com\/invoice\/[^?#]+\/pdf(?:[?#]|$)/;

const dateFields = ["date", "created", "createdAt", "issuedAt", "periodEnd", "period_end"];
const amountFields = ["total", "amountPaid", "amount_paid", "amount", "amountDue", "amount_due"];

/** An invoice not yet paid: shown, not ticked, as only a paid one is a receipt. */
const unpaidScore = 4;

/** A paid invoice: ticked. */
const paidScore = 8;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function first(object: Record<string, Json>, fields: string[]): Json | undefined {
  return fields.map((f) => object[f]).find((v) => v !== undefined && v !== null);
}

/** A date in seconds (Stripe's) or milliseconds, or one as text, as 2026-10-06. */
function dateOf(value: Json | undefined): string | null {
  const time =
    typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : typeof value === "string" ? Date.parse(value) : NaN;

  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

/** An amount in the currency's smallest unit, as Stripe keeps it, shown in the currency: 93750 usd is $937.50. */
function amountOf(value: Json | undefined, currency: Json | undefined): string | null {
  if (typeof value !== "number" || typeof currency !== "string" || !/^[a-z]{3}$/i.test(currency)) {
    return null;
  }

  try {
    const format = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() });
    const decimals = format.resolvedOptions().maximumFractionDigits ?? 2;

    return format.format(value / 10 ** decimals);
  } catch {
    return null;
  }
}

/** Paid, by a paid flag or a status. Unknown counts as paid: a list of past invoices is mostly paid ones. */
function paidOf(object: Record<string, Json>): boolean {
  if (typeof object.paid === "boolean") {
    return object.paid;
  }

  if (typeof object.status === "string") {
    return object.status.toLowerCase() === "paid";
  }

  return true;
}

/** Every Stripe invoice in a billing API's answer, as the scan would list it, named by its vendor. */
export function stripeInvoices(json: Json, vendor: string): Found[] {
  const found = new Map<string, Found>();

  const visit = (node: Json) => {
    if (Array.isArray(node)) {
      node.forEach(visit);

      return;
    }

    if (!node || typeof node !== "object") {
      return;
    }

    const pdf = Object.values(node).find((v): v is string => typeof v === "string" && stripePdf.test(v));

    if (pdf && !found.has(pdf)) {
      const paid = paidOf(node);

      found.set(pdf, {
        id: pdf,
        kind: "file",
        url: pdf,
        label: `${vendor} invoice`,
        context: paid ? "" : "Not paid yet",
        amount: amountOf(first(node, amountFields), node.currency),
        date: dateOf(first(node, dateFields)),
        score: paid ? paidScore : unpaidScore,
      });
    }

    Object.values(node).forEach(visit);
  };

  visit(json);

  return [...found.values()];
}

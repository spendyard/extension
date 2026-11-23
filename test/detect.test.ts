// Finding receipts on pages (src/detect.ts), on a few kept as they come:
// a table of invoices, an invoice hosted by Stripe, an order confirmation, a
// shop with a menu link; and the sites with rules of their own (src/sites.ts).

import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import type { Found, Scan } from "../src/found";

const detect = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/detect.ts`], target: "browser" });
const code = await detect.outputs[0]!.text();

/** The page, scanned as the panel does it. */
async function scan(name: string, url = `https://acme.example/${name}`): Promise<{ scan: Scan; snapshot: string }> {
  const window = new Window({ url });

  window.document.write(readFileSync(`${import.meta.dir}/pages/${name}`, "utf8"));
  window.eval(code);

  const page = window as unknown as { spendyardScan: () => Scan; spendyardSnapshot: () => string };
  const scanned = { scan: page.spendyardScan(), snapshot: page.spendyardSnapshot() };

  await window.happyDOM.close();

  return scanned;
}

const brief = (f: Found) => ({ label: f.label, amount: f.amount, date: f.date, url: f.url });

it("finds only the PDFs in a billing table, with their amount and date, never its links to invoice pages", async () => {
  const { found } = (await scan("billing.html")).scan;

  expect(found.map(brief)).toEqual([
    { label: "invoice-2026-11.pdf", amount: "$60.00", date: "Nov 3, 2026", url: "https://acme.example/files/invoice-2026-11.pdf" },
    // A PDF that isn't one: shown, not ticked.
    { label: "terms.pdf", amount: null, date: null, url: "https://acme.example/terms.pdf" },
  ]);

  expect(found.filter((f) => f.score >= 5)).toHaveLength(1);
});

it("doesn't take an order confirmation's page for a receipt, but keeps it without its scripts to send by hand", async () => {
  const { scan: scanned, snapshot } = await scan("order.html");

  expect(scanned.found).toEqual([]);
  expect(snapshot).not.toContain("<script");
  expect(snapshot).toContain('<base href="https://acme.example/order.html">');
});

it("finds a Stripe-hosted invoice's PDF, whose path ends /pdf rather than .pdf", async () => {
  const { found } = (await scan("invoice.html")).scan;

  expect(found.map((f) => new URL(f.url).host + new URL(f.url).pathname.replace(/[^/]+(?=\/pdf$)/, "…"))).toEqual(["pay.stripe.com/invoice/acct_1Abc/…/pdf"]);
  expect(found[0]!.score).toBeGreaterThanOrEqual(5);

  // Named by the page, as the link only says Download and its file is called "pdf". The total is further off
  // than the link's own block, so no amount.
  expect(found.map((f) => [f.label, f.amount, f.date])).toEqual([["Invoice | Acme Cloud", null, "Sep 14, 2026"]]);
});

it("names icon links by their tooltip, reads the payment's amount and not the card's digits, and ticks a row's receipt over its invoice", async () => {
  const { found } = (await scan("payments.html")).scan;

  expect(found.map((f) => [f.label, f.amount, f.date, new URL(f.url).pathname, f.score >= 5])).toEqual([
    ["Download receipt", "$19.00", "2026-11-01", "/billing/receipt/abc123.pdf", true],
    ["Download receipt", "$41.42", "2026-10-29", "/billing/receipt/def456.pdf", true],
    // The same payment's invoice: shown, not ticked.
    ["Download invoice", "$19.00", "2026-11-01", "/billing/invoice/abc123.pdf", false],
  ]);
});

it("doesn't take a menu link to Invoices, or a shop's prices, for a receipt", async () => {
  const { found } = (await scan("shop.html")).scan;

  expect(found).toEqual([]);
});

it("names what it sends by what it is, never by an id from its URL", async () => {
  const { looksLikeId } = await import("../src/found");

  expect(looksLikeId("inv_c3RyaXBlOmluXzFVSUNhcUdJcGRLRlVtUFk0UU12SUg4VA.html")).toBe(true);
  expect(looksLikeId("in_1QabcDEFghiJKLmnoPQRstuv")).toBe(true);
  expect(looksLikeId("invoice-2026-11.pdf")).toBe(false);
  expect(looksLikeId("View invoice")).toBe(false);
  expect(looksLikeId("Receipt-2134-5521.pdf")).toBe(false);
});

it("names a hosted invoice by its page's title, or by its site when it has none", async () => {
  const { nameFor } = await import("../src/fetch");

  const id = "inv_c3RyaXBlOmluXzFVSUNhcUdJcGRLRlVtUFk0UU12SUg4VA";
  const found: Found = { id, kind: "file", url: `https://invoice.stripe.com/i/acct_1/${id}`, label: id, context: "", amount: null, date: null, score: 6 };

  expect(nameFor(null, found, "text/html", "Invoice #1234 from Acme Cloud")).toBe("Invoice #1234 from Acme Cloud.html");
  expect(nameFor(null, found, "text/html")).toBe("Receipt from invoice.stripe.com.html");
  expect(nameFor("Invoice-1234.pdf", found, "application/pdf")).toBe("Invoice-1234.pdf");
});

it("lists a Vercel invoice list's rows to open, each with its amount and date, as its rule says", async () => {
  const { found, follow } = (await scan("vercel-invoices.html", "https://vercel.com/account/settings/invoices")).scan;

  expect(found).toEqual([]);
  expect(follow.map((f) => [f.label, f.amount, f.date, new URL(f.url).pathname.slice(0, 26)])).toEqual([
    ["Vercel invoice", "$25.00", "Sep 14, 2026", "/account/invoices/inv_c3Ry"],
    ["Vercel invoice", "$25.00", "Aug 14, 2026", "/account/invoices/inv_c3Ry"],
  ]);
});

it("takes the Stripe PDF from a Vercel invoice's own page, query and all", async () => {
  const { pdfIn } = await import("../src/follow");
  const { rules } = await import("../src/sites");

  const html = readFileSync(`${import.meta.dir}/pages/vercel-invoice.html`, "utf8");
  const pdf = rules.find((r) => r.name === "Vercel")!.follow!.pdf;

  expect(pdfIn(html, "https://vercel.com/account/invoices/inv_1", pdf)).toBe(
    "https://pay.stripe.com/invoice/acct_1Abc/test_YWNjdF8xQWJjLF9UZXN0/pdf?s=ap&r=1",
  );
  expect(pdfIn("<a href='/account/support'>Help</a>", "https://vercel.com/", pdf)).toBeNull();
});

it("on GitHub's payment history, ticks each receipt PDF by its rule, and opens nothing", async () => {
  const { found, follow } = (await scan("payments.html", "https://github.com/organizations/acme/billing/history")).scan;

  expect(found.filter((f) => f.score >= 5).map((f) => [f.label, f.amount, new URL(f.url).pathname])).toEqual([
    ["GitHub receipt", "$19.00", "/billing/receipt/abc123.pdf"],
    ["GitHub receipt", "$41.42", "/billing/receipt/def456.pdf"],
  ]);
  expect(follow).toEqual([]);
});

it("finds a site's rule by its host, a subdomain included, and its page", async () => {
  const { ruleFor } = await import("../src/sites");

  expect(ruleFor(new URL("https://vercel.com/account/settings/invoices"))?.name).toBe("Vercel");
  expect(ruleFor(new URL("https://github.com/organizations/acme/billing/history"))?.name).toBe("GitHub");
  expect(ruleFor(new URL("https://github.com/acme/repo"))).toBeNull();
  expect(ruleFor(new URL("https://notvercel.com/account/settings/invoices"))).toBeNull();
});

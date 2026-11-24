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
async function scan(name: string, url = `https://acme.example/${name}`, calls: string[] = []): Promise<{ scan: Scan; snapshot: string }> {
  const window = new Window({ url });

  // What watch.ts would have seen the page call.
  Object.assign(window, { spendyardCalls: calls });
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
  expect(ruleFor(new URL("https://miro.com/app/settings/company/1234567890/billing"))?.name).toBe("Miro");
});

it("reads Stripe's invoices from a billing API's answer: the paid ones ticked, the unpaid one shown, in their currency", async () => {
  const { stripeInvoices } = await import("../src/stripe");

  const json = JSON.parse(readFileSync(`${import.meta.dir}/pages/miro-invoices.json`, "utf8"));
  const found = stripeInvoices(json, "Miro");

  expect(found.map((f) => [f.label, f.amount, f.date, f.context, f.score >= 5])).toEqual([
    ["Miro invoice", "$1,209.05", "2026-11-06", "Not paid yet", false],
    ["Miro invoice", "$937.50", "2026-10-06", "", true],
    ["Miro invoice", "$1,093.75", "2026-09-05", "", true],
  ]);
  expect(found[1]!.url).toBe("https://pay.stripe.com/invoice/acct_1Test/test_BBBBBBBBBBBBBBBBBBBBBBBBBBBB/pdf?s=ap");
  expect(stripeInvoices({ invoices: [{ pdf: "https://example.com/invoice.pdf" }] }, "Miro")).toEqual([]);
});

it("on Miro's billing page, with no API call to be seen, reads its organisation's invoices at the rule's address", async () => {
  const { found, read } = (await scan("miro-billing.html", "https://miro.com/app/settings/company/1234567890/billing/")).scan;

  expect(found).toEqual([]);
  expect(read).toEqual([
    { url: "https://svc.eu01.miro.com/api/billing-and-payment/public/api/v1/organizations/1234567890/invoices", vendor: "Miro" },
  ]);
});

it("reads the dates billing pages show, and ticks the likely receipts of the last 12 months, or undated ones", async () => {
  const { dateValue, ticksByDefault } = await import("../src/found");

  const day = (d: string | null) => dateValue(d)?.toISOString().slice(0, 10) ?? null;

  expect(day("2026-11-01")).toBe("2026-11-01");
  expect(day("03.09.2026")).toBe("2026-09-03");
  expect(day("11/03/2026")).toBe("2026-11-03");
  expect(day("25/03/2026")).toBe("2026-03-25");
  expect(day("Sep 14, 2026")).toBe("2026-09-14");
  expect(day("14. okt 2026")).toBe("2026-10-14");
  expect(day("someday")).toBeNull();

  const now = new Date("2026-11-24T12:00:00Z");
  const receipt = (date: string | null, score = 8): Found => ({ id: date ?? "none", kind: "file", url: "https://x.example/r.pdf", label: "r", context: "", amount: null, date, score });

  expect(ticksByDefault(receipt("2026-11-06"), now)).toBe(true);
  expect(ticksByDefault(receipt("2025-11-25"), now)).toBe(true);
  expect(ticksByDefault(receipt("2025-11-23"), now)).toBe(false);
  expect(ticksByDefault(receipt("2020-10-22"), now)).toBe(false);
  expect(ticksByDefault(receipt(null), now)).toBe(true);
  expect(ticksByDefault(receipt("2026-11-06", 4), now)).toBe(false);
});

// ——— With no rule: what general.ts does on a site never tried ———

it("with no rule, opens the invoice pages a list's rows link to, and names them by the site", async () => {
  const { follow } = (await scan("vercel-invoices.html", "https://app.newsaas.example/account/settings/invoices")).scan;

  expect(follow.map((f) => [f.label, f.amount, f.date, new URL(f.url).pathname.slice(0, 26)])).toEqual([
    ["Newsaas invoice", "$25.00", "Sep 14, 2026", "/account/invoices/inv_c3Ry"],
    ["Newsaas invoice", "$25.00", "Aug 14, 2026", "/account/invoices/inv_c3Ry"],
  ]);
});

it("with no rule, opens a row's invoice page, but not the menu's Invoices, another site's page or a PDF", async () => {
  const { follow } = (await scan("billing.html")).scan;

  expect(follow.map((f) => new URL(f.url).pathname)).toEqual(["/billing/invoice/in_123"]);
  expect((await scan("shop.html")).scan.follow).toEqual([]);
});

it("takes the likeliest PDF from an invoice's page: Stripe's, then one named so, from its links or its data", async () => {
  const { pdfIn } = await import("../src/follow");
  const { anyPdf } = await import("../src/general");

  const vercel = readFileSync(`${import.meta.dir}/pages/vercel-invoice.html`, "utf8");

  expect(pdfIn(vercel, "https://vercel.com/", anyPdf)).toBe("https://pay.stripe.com/invoice/acct_1Abc/test_YWNjdF8xQWJjLF9UZXN0/pdf?s=ap&r=1");
  expect(pdfIn('<a href="/terms.pdf">Terms</a> <a href="/files/invoice-12.pdf">Download</a>', "https://acme.example/", anyPdf)).toBe(
    "https://acme.example/files/invoice-12.pdf",
  );
  expect(pdfIn('<script>{"pdf":"https:\\/\\/pay.stripe.com\\/invoice\\/acct_1\\/test_A\\/pdf?s=ap"}</script>', "https://x.example/", anyPdf)).toBe(
    "https://pay.stripe.com/invoice/acct_1/test_A/pdf?s=ap",
  );
});

it("with no rule, reads the page's call to its own billing API's list, and no other call", async () => {
  const calls = [
    "https://svc.eu01.boards.example/api/v1/organizations/1/invoices",
    "https://svc.eu01.boards.example/api/v1/organizations/1/subscription/downgrade",
    "https://tracker.elsewhere.example/v1/invoices",
  ];
  const { read } = (await scan("miro-billing.html", "https://boards.example/app/settings/company/1/billing/", calls)).scan;

  expect(read).toEqual([{ url: "https://svc.eu01.boards.example/api/v1/organizations/1/invoices", vendor: "Boards" }]);
});

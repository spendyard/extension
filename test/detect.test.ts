// Finding receipts on pages (src/detect.ts), on a few kept as they come:
// a table of invoices, an order confirmation, and a shop with a menu link.

import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import type { Found, Scan } from "../src/found";

const detect = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/detect.ts`], target: "browser" });
const code = await detect.outputs[0]!.text();

/** The page, scanned as the panel does it. */
async function scan(name: string): Promise<{ scan: Scan; snapshot: string }> {
  const window = new Window({ url: `https://acme.example/${name}` });

  window.document.write(readFileSync(`${import.meta.dir}/pages/${name}`, "utf8"));
  window.eval(code);

  const page = window as unknown as { spendyardScan: () => Scan; spendyardSnapshot: () => string };
  const scanned = { scan: page.spendyardScan(), snapshot: page.spendyardSnapshot() };

  await window.happyDOM.close();

  return scanned;
}

const brief = (f: Found) => ({ label: f.label, amount: f.amount, date: f.date, url: f.url });

it("finds each invoice in a billing table, with its amount and date, the likely ones first", async () => {
  const { found } = (await scan("billing.html")).scan;

  expect(found.map(brief)).toEqual([
    { label: "invoice-2026-11.pdf", amount: "$60.00", date: "Nov 3, 2026", url: "https://acme.example/files/invoice-2026-11.pdf" },
    { label: "View invoice", amount: "$60.00", date: "Oct 3, 2026", url: "https://acme.example/billing/invoice/in_123" },
    { label: "Receipt", amount: "NOK 640,00", date: "03.09.2026", url: "https://pay.example.com/receipt/abc" },
    // A PDF that isn't one: shown, not ticked.
    { label: "terms.pdf", amount: null, date: null, url: "https://acme.example/terms.pdf" },
  ]);

  expect(found.filter((f) => f.score >= 5)).toHaveLength(3);
});

it("finds an order confirmation as a receipt itself, and keeps it without its scripts", async () => {
  const { scan: scanned, snapshot } = await scan("order.html");

  expect(scanned.found.map((f) => [f.kind, f.amount, f.date])).toEqual([["page", "648,-", "21.11.2026"]]);
  expect(snapshot).not.toContain("<script");
  expect(snapshot).toContain('<base href="https://acme.example/order.html">');
});

it("doesn't take a menu link to Invoices, or a shop's prices, for a receipt", async () => {
  const { found } = (await scan("shop.html")).scan;

  expect(found).toEqual([]);
});

# Spendyard for Chrome

A browser extension that finds the receipts and invoices on the page you're
looking at and sends the ones you pick to Spendyard.

- **The side panel** (the toolbar button) lists the PDFs it found on the
  page: those linked from it (a billing table's "Download" links), those
  shown in it, and the PDF open in the tab. Only PDFs: never the page itself
  or a page it links to, even one that calls itself an invoice, and never an
  image. The likely ones from the last 12 months are ticked (older ones are listed,
  unticked); **Send** sends them. **Send the whole page**
  sends the page itself, by hand.
- **Right-click** a link, an image or the page: *Send to Spendyard*.
- **Drop files** on the panel, or choose them.

## On a site never tried

What the rules below taught, done on any billing page (`src/general.ts`):

- **Stripe everywhere**: its hosted PDF is a PDF, its hosted invoice page is
  opened for that PDF, and its invoices are read from any billing API's
  answer (`src/stripe.ts`).
- **Rows that link to each invoice's page**: a row with an amount and a date,
  linking to the site's own page for one invoice or receipt, is opened for its
  PDF; the likeliest one there is taken (Stripe's, then one named so).
- **The billing API behind a list**: a call the page made on its own site
  whose path ends `invoices` or `receipts` is read again, only with a GET,
  for the Stripe invoices in it. `src/watch.ts` notes those calls from each
  page's start (their URLs, nothing else), as the browser's own list of calls
  fills up on a busy app before the billing call is made.

Vercel's and Miro's invoices are found this way with their rules switched off.

## Site rules

Most billing pages are read the same way: PDF links, scored by what's said
around them. Some need more, and `src/sites.ts` keeps a rule for each, as data
(patterns in strings), each checked against a page kept in `test/pages`:

- **which PDFs are receipts or invoices**: ticked, the receipt over the
  invoice when a payment has both (GitHub's payment history);
- **invoice pages to open**: a list whose rows only link to each invoice's own
  page, the PDF only there. The panel opens those pages, two at a time and at
  most 24, as you, reads their links and lists each one's PDF with its row's
  amount and date (Vercel's invoices, whose PDFs are Stripe's);
- **a billing API to read**: a list drawn from the vendor's own API, its
  Download buttons with nothing behind them. The panel reads it in the tab, as
  the page would and only ever with a GET, and lists the Stripe invoices in it
  (`src/stripe.ts`: each one's hosted PDF, date, total in its currency and
  whether it's paid), the paid ones ticked and an unpaid one shown (Miro's).

A rule only adds to what the scan finds; on a site it doesn't know, or one
that has changed, the general scan still runs.

Detection reads only the page, in the extension's own isolated world
(`src/detect.ts`), and only when the panel is open; and where a rule says so,
the invoice pages it links to or the billing API it draws its list from. Linked files are fetched as
you, so a billing page's invoices come with your sign-in to that site. Nothing
leaves the browser except what you send.

## Signing in

The extension never uses the dashboard's cookie. **Connect to Spendyard** opens
the dashboard's `/connect/extension` page, where you pick the organisation; the
page hands the extension a token of its own (`chrome.runtime.sendMessage`,
allowed by the manifest's `externally_connectable`). That token:

- may only say who it's connected as and send documents;
- acts only in the organisation it was connected to;
- is listed in Settings → Account as *Spendyard extension · Chrome on macOS*,
  and signed out there; **Disconnect** in the panel ends it too;
- lasts 90 days from its last use.

The server only hands tokens to the extension ids it is configured with
(`EXTENSION_IDS`, in Spendyard Cloud's own settings). The manifest's `key` gives a development
build the id `jeooahbbldceddcpfgobjgflejbagejj` wherever it's loaded from;
the Chrome Web Store's id joins it once it's listed.

## Building and loading it

```bash
bun install && bun run build
```

Then `chrome://extensions` → Developer mode → **Load unpacked** →
`dist`. `bun run build --watch` rebuilds on every change; reload
the extension on that page to take it.

To work against a local server, run Spendyard Cloud's Worker and dashboard
from the platform repository (`bun run dev` at its root, and
`cd web && bun run dev`), and pick *Local* in the panel before connecting.

## Checking it

```bash
bun run typecheck
bun test        # detection on the pages in test/pages
```

## Layout

| File | What |
| --- | --- |
| `public/manifest.json` | Manifest V3: side panel, context menu, `<all_urls>` to read pages and fetch their files, `watch.js` in every page |
| `src/background.ts` | The service worker: the button, the right-click menu, taking the token |
| `src/detect.ts` | Run in the page: which PDFs are receipts, and a snapshot of the page |
| `src/panel.ts` | The side panel |
| `src/sites.ts` | The rules for particular billing pages |
| `src/follow.ts` | Opening an invoice's own page for its PDF |
| `src/stripe.ts` | Stripe's invoices in a billing API's answer |
| `src/general.ts` | What the scan does on a site with no rule |
| `src/watch.ts` | From each page's start: its calls to a billing API |
| `src/fetch.ts` | A receipt's bytes: a linked file, or the page as HTML |
| `src/api.ts` | The Connect API in JSON, with the token |
| `src/connection.ts`, `src/pending.ts` | What's kept in `chrome.storage` |

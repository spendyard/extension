# Spendyard for Chrome

A browser extension that finds the receipts and invoices on the page you're
looking at, and downloads the ones you pick or uploads them to Spendyard.

- **The badge** on the toolbar button says how many receipts the page has,
  before the panel is opened: counted in the page as it loads and changes
  (`src/watch.ts`, only on a page that looks like billing or links to a PDF
  or to Stripe), the panel's own count once it has looked further; `•` when
  the receipts are behind a billing API that only the panel reads.
- **The side panel** (the toolbar button) first says how many receipts it
  found on the page, the count growing as invoice pages and billing APIs
  answer. **Show them** lists them: PDFs only (linked from the page, shown in
  it, open in the tab, or behind a list's rows and billing API), never the
  page itself or an image. The likely ones from the last 12 months are ticked;
  **All** and **None** change that.
- **Already in Spendyard**: what this browser uploaded is remembered, for
  each Spendyard and organisation (`src/uploaded.ts`), the server's own
  "already had it" too, and shown as *Already in Spendyard · Open*, unticked;
  a Stripe invoice is known again under its next address. A receipt that
  reached Spendyard another way isn't known.
- **Stripe's receipts**: a paid Stripe invoice is downloaded and uploaded
  as its receipt (`src/stripe-receipts.ts`), which says it was paid, when and
  with which card; the invoice's own PDF only says what was due. Stripe's
  invoice page asks `invoicedata.stripe.com` for it, and so does the
  extension; an invoice not paid yet has none, and goes as itself.
- **Load more**: a list that shows a few at a time has its Load more (Show
  more, Vis flere…) pressed by the panel, as you would, until it reaches back
  past 12 months, ten presses at most; **Load more** in the list goes further.
  Only while the panel is open, and only on a page with receipts.
- **Download** saves the ticked ones to the Downloads folder, named as an
  upload would name them; it needs no connection. **Upload** sends them to
  Spendyard, and asks to connect first when it isn't. **Send page** sends
  the page itself, by hand.
- **Downloaded by hand**: a PDF you download while the panel is open (a
  billing page's Download button that the scan can't see behind) is offered
  under *Downloaded just now*, to upload. It's got again from where it came
  from, or from the page that made it; when neither works, *Show in folder*
  finds it to drop on the panel.
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
(`src/scan.ts`): to count for the badge as a billing page loads, and in full
when the panel is open; and where a rule says so,
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
| `src/scan.ts` | Reading a page: which PDFs are receipts, invoice pages and billing APIs to look at |
| `src/detect.ts` | Run in the page when the panel scans, and a snapshot of the page |
| `src/panel.ts` | The side panel |
| `src/sites.ts` | The rules for particular billing pages |
| `src/follow.ts` | Opening an invoice's own page for its PDF |
| `src/stripe-receipts.ts` | A paid Stripe invoice's receipt, in its place |
| `src/stripe.ts` | Stripe's invoices in a billing API's answer |
| `src/general.ts` | What the scan does on a site with no rule |
| `src/watch.ts` | From each page's start: the badge's count, and its calls to a billing API |
| `src/fetch.ts` | A receipt's bytes: a linked file, or the page as HTML |
| `src/api.ts` | The Connect API in JSON, with the token |
| `src/connection.ts`, `src/pending.ts` | What's kept in `chrome.storage` |

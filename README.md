# Spendyard for Chrome

A browser extension that finds the receipts and invoices on the page you're
looking at and sends the ones you pick to Spendyard.

- **The side panel** (the toolbar button) lists the PDFs it found on the
  page: those linked from it (a billing table's "Download" links), those
  shown in it, and the PDF open in the tab. Only PDFs: never the page itself
  or a page it links to, even one that calls itself an invoice, and never an
  image. The likely ones are ticked; **Send** sends them. **Send the whole page**
  sends the page itself, by hand.
- **Right-click** a link, an image or the page: *Send to Spendyard*.
- **Drop files** on the panel, or choose them.

## Site rules

Most billing pages are read the same way: PDF links, scored by what's said
around them. Some need more, and `src/sites.ts` keeps a rule for each, as data
(patterns in strings), each checked against a page kept in `test/pages`:

- **which PDFs are receipts or invoices**: ticked, the receipt over the
  invoice when a payment has both (GitHub's payment history);
- **invoice pages to open**: a list whose rows only link to each invoice's own
  page, the PDF only there. The panel opens those pages, two at a time and at
  most 24, as you, reads their links and lists each one's PDF with its row's
  amount and date (Vercel's invoices, whose PDFs are Stripe's).

A rule only adds to what the scan finds; on a site it doesn't know, or one
that has changed, the general scan still runs.

Detection reads only the page, in the extension's own isolated world
(`src/detect.ts`), and only when the panel is open; and where a rule says so,
the invoice pages it links to. Linked files are fetched as
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
| `public/manifest.json` | Manifest V3: side panel, context menu, `<all_urls>` to read pages and fetch their files |
| `src/background.ts` | The service worker: the button, the right-click menu, taking the token |
| `src/detect.ts` | Run in the page: which PDFs are receipts, and a snapshot of the page |
| `src/panel.ts` | The side panel |
| `src/sites.ts` | The rules for particular billing pages |
| `src/follow.ts` | Opening an invoice's own page for its PDF |
| `src/fetch.ts` | A receipt's bytes: a linked file, or the page as HTML |
| `src/api.ts` | The Connect API in JSON, with the token |
| `src/connection.ts`, `src/pending.ts` | What's kept in `chrome.storage` |

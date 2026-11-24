// PDFs downloaded by hand while the panel is open: a billing page's Download
// button with nothing behind it that the scan can see (it asks the vendor's
// API for the file, then downloads it). chrome.downloads says a PDF arrived;
// the panel offers to upload it.
//
// An extension can't read the Downloads folder, so the file is got again from
// where it came from: its address, fetched as the person, or, when the page
// made it itself (a blob: address), from the page, in the tab it came from.
// When neither works, the panel shows the file in its folder to drop on it.

import { isPdfBytes, type Got } from "./fetch";
import { stripeReceiptOf } from "./stripe-receipts";

/** A PDF downloaded by hand, as the panel offers it. */
export interface Downloaded {
  /** chrome.downloads' id, to show it in its folder. */
  downloadId: number;

  /** Where it came from: an address to fetch again, or the page's own blob: or data: one. */
  url: string;

  /** Its file's name, as it was saved. */
  name: string;

  /** The site it was downloaded from. */
  from: string;
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

/** A finished download, if it's a PDF the person downloaded (not one of the panel's own). */
export function pdfDownload(item: chrome.downloads.DownloadItem, ownId: string): Downloaded | null {
  if (item.state !== "complete" || item.byExtensionId === ownId) {
    return null;
  }

  const name = item.filename.split(/[\\/]/).pop() ?? "";

  if (item.mime !== "application/pdf" && !/\.pdf$/i.test(name)) {
    return null;
  }

  const url = item.finalUrl || item.url;
  const pageMade = /^(?:blob|data):/i.test(url);

  // The page it was downloaded from says most (miro.com, not files.stripe.com); else a blob: address's own page.
  const from = hostOf(item.referrer) || (pageMade ? hostOf(url.replace(/^blob:/i, "")) : hostOf(url));

  return { downloadId: item.id, url, name: name || "Receipt.pdf", from };
}

/** The bytes as a PDF to upload, or an error saying it isn't one. */
function asPdf(bytes: Uint8Array<ArrayBuffer>, name: string): Got {
  if (!isPdfBytes(bytes)) {
    throw new Error("Not a PDF any more: drop the downloaded file here instead");
  }

  return { name, contentType: "application/pdf", bytes };
}

/** A page-made file, read in the page it was downloaded from (the active tab), as base64. */
async function fromPage(tabId: number, url: string): Promise<Uint8Array<ArrayBuffer>> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [url],
    func: async (address: string) => {
      const bytes = new Uint8Array(await (await fetch(address)).arrayBuffer());
      let text = "";

      for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }

      return btoa(text);
    },
  });

  const base64 = result?.result;

  if (typeof base64 !== "string") {
    throw new Error("Gone from the page");
  }

  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** A downloaded PDF got again, to upload: from its address, or from the page that made it. */
export async function bytesOf(downloaded: Downloaded, tabId: number | null): Promise<Got> {
  const { url, name } = downloaded;

  try {
    if (/^blob:/i.test(url)) {
      if (tabId === null) {
        throw new Error("no tab");
      }

      return asPdf(await fromPage(tabId, url), name);
    }

    // A paid Stripe invoice goes as its receipt, which says it was paid.
    const receipt = await stripeReceiptOf(url);
    const response = await fetch(receipt ?? url, { credentials: receipt ? "omit" : "include" });

    if (!response.ok) {
      throw new Error(`answered ${response.status}`);
    }

    const receiptName = receipt ? response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1] : null;

    return asPdf(new Uint8Array(await response.arrayBuffer()), receiptName ?? name);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Not a PDF")) {
      throw e;
    }

    // A one-time address, or a page that let its file go: only the file in Downloads is left.
    throw new Error("Couldn't get it again: drop the downloaded file here");
  }
}

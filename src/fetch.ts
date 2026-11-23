// Getting a receipt's bytes: a linked file fetched as the person (their
// cookies on that site go along, as the extension may reach every site), or
// the page itself as one HTML file (detect.ts's snapshot).

import type { Found } from "./found";

/** As the server takes them (documents/intake.ts). */
const largest = 25 * 1024 * 1024;

export interface Got {
  name: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** What the first bytes say a file is, whatever the server called it. */
function sniff(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((b, i) => bytes[i] === b);

  if (starts(0x25, 0x50, 0x44, 0x46)) {
    return "application/pdf";
  }

  if (starts(0x89, 0x50, 0x4e, 0x47)) {
    return "image/png";
  }

  if (starts(0xff, 0xd8, 0xff)) {
    return "image/jpeg";
  }

  if (starts(0x47, 0x49, 0x46, 0x38)) {
    return "image/gif";
  }

  const riff = starts(0x52, 0x49, 0x46, 0x46);
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

  if (riff && webp) {
    return "image/webp";
  }

  return null;
}

/** The name Content-Disposition gives, if any. */
function dispositionName(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const encoded = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);

  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]!.trim().replace(/^"|"$/g, ""));
    } catch {
      // Then the plain one.
    }
  }

  return header.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

const extensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "text/html": ".html",
};

/** A name to keep it by: the one it came with, or its label, ending as its type does. */
function nameFor(given: string | null, found: Found, contentType: string): string {
  const fromUrl = new URL(found.url).pathname.split("/").pop() ?? "";
  const base = (given || (/\.\w{2,4}$/.test(fromUrl) ? fromUrl : "") || found.label || "receipt")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim()
    .slice(0, 120);

  const ending = extensions[contentType] ?? "";

  return ending && !base.toLowerCase().endsWith(ending) ? `${base}${ending}` : base;
}

/** A sign-in page sent back instead of the file: what a link gives once that site's session has ended. */
function looksLikeSignIn(response: Response): boolean {
  return response.redirected && /log-?in|sign-?in|auth|session/i.test(new URL(response.url).pathname);
}

async function fetchFile(found: Found): Promise<Got> {
  const response = await fetch(found.url, { credentials: "include" });

  if (!response.ok) {
    throw new Error(`${new URL(found.url).hostname} answered ${response.status}`);
  }

  if (looksLikeSignIn(response)) {
    throw new Error(`${new URL(found.url).hostname} asked to sign in instead`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > largest) {
    throw new Error("Larger than 25 MB");
  }

  const said = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const contentType = sniff(bytes) ?? (said === "text/html" ? "text/html" : null);

  if (!contentType) {
    throw new Error(`Not a PDF, an image or a page (${said || "no type"})`);
  }

  const given = dispositionName(response.headers.get("content-disposition"));

  return { name: nameFor(given, found, contentType), contentType, bytes };
}

async function snapshotPage(tabId: number, found: Found): Promise<Got> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (globalThis as unknown as { spendyardSnapshot: () => string }).spendyardSnapshot(),
  });

  const html = result?.result;

  if (typeof html !== "string") {
    throw new Error("Couldn't read the page");
  }

  const bytes = new TextEncoder().encode(html);

  if (bytes.byteLength > largest) {
    throw new Error("The page is larger than 25 MB");
  }

  return { name: nameFor(null, found, "text/html"), contentType: "text/html", bytes };
}

/** The receipt's file, from the tab it was found in. */
export function get(tabId: number, found: Found): Promise<Got> {
  return found.kind === "page" ? snapshotPage(tabId, found) : fetchFile(found);
}

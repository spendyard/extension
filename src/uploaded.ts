// What this browser has uploaded, for each Spendyard and organisation: which
// receipt it was (found.ts's receiptKey, so a Stripe invoice is known again
// under its next address) and the document it became, the server's own
// "already had it" included. The panel shows those as Already in Spendyard,
// unticked. Only what was uploaded from here: a receipt that reached Spendyard
// by mail, the CLI or another browser isn't known.

import type { Connection } from "./connection";

export interface Remembered {
  documentId: string;
  /** When it was uploaded, in milliseconds. */
  at: number;
}

/** The most kept for one organisation: the oldest go first. */
const mostKept = 5000;

function storageKey(connection: Connection): string {
  return `uploaded:${connection.server}:${connection.org.id}`;
}

/** What this browser has uploaded to the connection's organisation, by receipt. */
export async function remembered(connection: Connection): Promise<Map<string, Remembered>> {
  const key = storageKey(connection);
  const stored = await chrome.storage.local.get(key);

  return new Map(Object.entries((stored[key] as Record<string, Remembered> | undefined) ?? {}));
}

/** Remembers receipts as uploaded, as the document the server gave them. */
export async function remember(connection: Connection, receipts: string[], documentId: string): Promise<void> {
  if (receipts.length === 0) {
    return;
  }

  const known = await remembered(connection);
  const at = Date.now();

  receipts.forEach((receipt) => known.set(receipt, { documentId, at }));

  const newestFirst = [...known.entries()].sort(([, a], [, b]) => b.at - a.at).slice(0, mostKept);

  await chrome.storage.local.set({ [storageKey(connection)]: Object.fromEntries(newestFirst) });
}

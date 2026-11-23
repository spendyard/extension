// Receipts sent from the right-click menu (background.ts), waiting for the
// panel to send them: in chrome.storage.session, so they're there when the
// panel has just opened, and gone when the browser closes.

import type { Found } from "./found";

export interface Pending {
  tabId: number;
  found: Found;
}

const key = "pending";

export async function add(item: Pending): Promise<void> {
  const stored = await chrome.storage.session.get(key);
  const waiting = (stored[key] as Pending[] | undefined) ?? [];

  await chrome.storage.session.set({ [key]: [...waiting, item] });
}

/** Everything waiting, taken: the panel sends each once. */
export async function take(): Promise<Pending[]> {
  const stored = await chrome.storage.session.get(key);
  const waiting = (stored[key] as Pending[] | undefined) ?? [];

  if (waiting.length > 0) {
    await chrome.storage.session.remove(key);
  }

  return waiting;
}

export function isPendingChange(changes: Record<string, chrome.storage.StorageChange>): boolean {
  return key in changes && Array.isArray(changes[key]?.newValue);
}

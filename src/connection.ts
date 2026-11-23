// Where the extension sends receipts, and with what: kept in
// chrome.storage.local once the dashboard's /connect/extension page hands it
// over (background.ts). The token is only ever sent to that server.

/** The Spendyards the extension may connect to: their dashboards, which serve the API too. */
export const servers = [
  { name: "Spendyard", origin: "https://app.spendyard.com" },
  { name: "Staging", origin: "https://staging.spendyard.com" },
  // The dashboard's dev server, which passes the API on to the Worker (web/vite.config.ts).
  { name: "Local", origin: "http://localhost:5174" },
] as const;

export function knownServer(origin: string): boolean {
  return servers.some((s) => s.origin === origin);
}

export interface Connection {
  /** The dashboard's origin: the API is there too. */
  server: string;
  token: string;
  org: { id: string; slug: string; name: string };
  email: string;
}

const key = "connection";

export async function connection(): Promise<Connection | null> {
  const stored = await chrome.storage.local.get(key);

  return (stored[key] as Connection | undefined) ?? null;
}

export async function keep(connection: Connection): Promise<void> {
  await chrome.storage.local.set({ [key]: connection });
}

export async function forget(): Promise<void> {
  await chrome.storage.local.remove(key);
}

/** Whether a change to storage is the connection's: for the panel to show it at once. */
export function isConnectionChange(changes: Record<string, chrome.storage.StorageChange>): boolean {
  return key in changes;
}

/** The dashboard's page that connects this extension. */
export function connectUrl(server: string): string {
  return `${server}/connect/extension?extension=${chrome.runtime.id}`;
}

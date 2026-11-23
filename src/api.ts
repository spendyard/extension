// Spendyard's API from the extension: the Connect services the dashboard
// calls (spendyard.api.v1, the contract at buf.build/spendyard/spendyard), in
// Connect's JSON over fetch, with the extension's own token, never a cookie.
// The token may only say who it's connected as and send documents (the
// server's authz.ts, extensionGrants). Only the fields used here are typed.

import type { Connection } from "./connection";

/** A Connect error: its code ("unauthenticated", "permission_denied", …) and message. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The token's gone: signed out in Settings → Account, disconnected, or unused for 90 days. */
export function signedOut(e: unknown): boolean {
  return e instanceof ApiError && e.code === "unauthenticated";
}

function authorised(connection: Connection): Record<string, string> {
  return { authorization: `Bearer ${connection.token}` };
}

async function call<T>(connection: Connection, service: string, method: string, request: object): Promise<T> {
  const url = `${connection.server}/spendyard.api.v1.${service}/${method}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "omit",
      headers: {
        ...authorised(connection),
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new ApiError("unavailable", `Can't reach ${new URL(connection.server).host}`);
  }

  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };

  if (!response.ok) {
    throw new ApiError(body.code ?? "unknown", body.message ?? `${response.status} from ${service}.${method}`);
  }

  return body as T;
}

/** Whether the token still works: who it's connected as. */
export async function whoAmI(connection: Connection): Promise<string> {
  const answer = await call<{ account?: { user?: { email?: string } } }>(connection, "AccountService", "GetAccount", {});

  return answer.account?.user?.email ?? "";
}

/** What came of sending one file. */
export interface Sent {
  documentId: string;

  /** It was there already: the same file sent before, or forwarded. */
  seen: boolean;
}

/** One file into the organisation's documents: a place to PUT it, the PUT, then taking it in. */
export async function sendDocument(connection: Connection, file: { name: string; contentType: string; bytes: Uint8Array<ArrayBuffer> }): Promise<Sent> {
  const upload = await call<{ uploadId: string; url: string; headers?: Record<string, string> }>(
    connection,
    "DocumentService",
    "CreateDocumentUpload",
    {
      name: file.name,
      contentType: file.contentType,
      size: String(file.bytes.byteLength),
    },
  );

  const put = await fetch(upload.url, {
    method: "PUT",
    credentials: "omit",
    headers: upload.headers ?? {},
    body: file.bytes,
  });

  if (!put.ok) {
    throw new ApiError("unavailable", `The upload was refused (${put.status})`);
  }

  const added = await call<{ document?: { id?: string }; seen?: boolean }>(
    connection,
    "DocumentService",
    "AddDocument",
    { uploadId: upload.uploadId },
  );

  return {
    documentId: String(added.document?.id ?? ""),
    seen: added.seen ?? false,
  };
}

/** Ends the token's session on the server. Gone here either way. */
export async function disconnect(connection: Connection): Promise<void> {
  await fetch(`${connection.server}/extension/disconnect`, {
    method: "POST",
    credentials: "omit",
    headers: authorised(connection),
  }).catch(() => undefined);
}

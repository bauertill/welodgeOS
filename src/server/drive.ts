import { createSign } from "crypto";
import { after } from "next/server";

import type { Prisma, PrismaClient } from "generated/prisma";

import { env } from "~/env";
import { logAudit } from "~/server/audit";

/**
 * Property folders on the We Lodge shared drive (doc §3.12, the owner
 * 2026-11-20). A property put on an event gets its folder where the team
 * keeps them by hand: <event folder> › 1_Accommodation › <property>, with the
 * five subfolders of the templates in 1_Accommodation › 1_Templates. A folder
 * already there under the property's name is used, never doubled.
 *
 * OS signs in to Drive as a Google service account (GOOGLE_DRIVE_SERVICE_ACCOUNT,
 * its JSON key) that is a member of the shared drive. Without it, nothing is
 * made and the property's panel says Drive is not connected.
 */

export const ACCOMMODATION = "1_Accommodation";
export const SUBFOLDERS = ["1_General Information", "2_Rates, Proposals & Policies", "3_Agreement & Addenda", "4_Finance & Confirmations", "5_Rooming Lists"];

const FOLDER = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3/files";

/** What OS needs from Drive — small, so the folder rules can be tested without Google. */
export type DriveApi = {
  /** The folders directly inside a folder. */
  folders(parentId: string): Promise<{ id: string; name: string }[]>;
  createFolder(parentId: string, name: string): Promise<string>;
  rename(id: string, name: string): Promise<void>;
  /** A folder's name, or null when it cannot be opened (missing, or not shared with OS). */
  folderName(id: string): Promise<string | null>;
};

export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** The folder id in a pasted Drive link (…/folders/<id>, ?id=<id>) or a bare id; null if it reads as neither. */
export function folderIdFrom(text: string) {
  const value = text.trim();
  if (!value) return null;
  const match = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(value) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(value);
  if (match) return match[1]!;
  return /^[A-Za-z0-9_-]{10,}$/.test(value) ? value : null;
}

/** Names compared the way people see them: case, spaces and curly quotes aside. */
const same = (a: string, b: string) => {
  const norm = (s: string) => s.normalize("NFC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
};

/** Drive folder names may not hold a slash in practice; keep the name readable. */
const folderName = (name: string) => name.replace(/[/\\]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 200);

// ---------- signing in as the service account ----------

type Key = { client_email: string; private_key: string };
let cached: { token: string; until: number } | null = null;

function key(): Key | null {
  const raw = env.GOOGLE_DRIVE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    // Pasted as the JSON itself, or base64 of it.
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text) as Partial<Key>;
    return parsed.client_email && parsed.private_key ? { client_email: parsed.client_email, private_key: parsed.private_key } : null;
  } catch {
    return null;
  }
}

/** The service account OS signs in as, to show the team which address to share with. */
export const driveAccount = () => key()?.client_email ?? null;

async function token(k: Key) {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: k.client_email, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(k.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** Drive as the service account, or null when it is not set up. */
export function googleDrive(): DriveApi | null {
  const k = key();
  if (!k) return null;
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${await token(k)}`, "content-type": "application/json", ...init.headers } });
    if (!res.ok) {
      const error = new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 300)}`) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    return res.json() as Promise<Record<string, unknown>>;
  };
  return {
    async folders(parentId) {
      const out: { id: string; name: string }[] = [];
      let page: string | undefined;
      do {
        const q = `'${parentId.replace(/'/g, "\\'")}' in parents and mimeType = '${FOLDER}' and trashed = false`;
        const params = new URLSearchParams({ q, fields: "nextPageToken, files(id, name)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives" });
        if (page) params.set("pageToken", page);
        const body = (await call(`?${params}`)) as { files: { id: string; name: string }[]; nextPageToken?: string };
        out.push(...body.files);
        page = body.nextPageToken;
      } while (page);
      return out;
    },
    async createFolder(parentId, name) {
      const body = (await call("?supportsAllDrives=true&fields=id", { method: "POST", body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }) })) as { id: string };
      return body.id;
    },
    async rename(id, name) {
      await call(`/${id}?supportsAllDrives=true&fields=id`, { method: "PATCH", body: JSON.stringify({ name }) });
    },
    async folderName(id) {
      try {
        const body = (await call(`/${id}?supportsAllDrives=true&fields=id,name,mimeType,trashed`)) as { name: string; mimeType: string; trashed: boolean };
        return body.mimeType === FOLDER && !body.trashed ? body.name : null;
      } catch (error) {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
    },
  };
}

// ---------- the rules ----------

export type FolderOutcome =
  | { status: "exists" | "made" | "linked"; folderId: string }
  | { status: "off" | "no-event-folder" | "gone" };

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The property's folder for this event: already linked, found under the
 * property's name in 1_Accommodation, or made there with the five
 * subfolders. 1_Accommodation itself is made if the event folder lacks it.
 */
export async function ensureEntryFolder(db: Db, entryId: string, drive: DriveApi | null = googleDrive(), actorId: string | null = null): Promise<FolderOutcome> {
  const entry = await db.scoutingEntry.findUnique({
    where: { id: entryId },
    select: { driveFolderId: true, event: { select: { driveFolderId: true } }, property: { select: { name: true } } },
  });
  if (!entry) return { status: "gone" };
  if (entry.driveFolderId) return { status: "exists", folderId: entry.driveFolderId };
  if (!drive) return { status: "off" };
  const eventFolder = entry.event.driveFolderId;
  if (!eventFolder) return { status: "no-event-folder" };

  const inEvent = await drive.folders(eventFolder);
  const accommodation = inEvent.find((f) => same(f.name, ACCOMMODATION))?.id ?? (await drive.createFolder(eventFolder, ACCOMMODATION));
  const name = folderName(entry.property.name);
  const found = (await drive.folders(accommodation)).find((f) => same(f.name, name));
  let folderId: string;
  let status: "made" | "linked";
  if (found) {
    folderId = found.id;
    status = "linked";
  } else {
    folderId = await drive.createFolder(accommodation, name);
    for (const sub of SUBFOLDERS) await drive.createFolder(folderId, sub);
    status = "made";
  }
  // Only if nobody linked one meanwhile.
  const saved = await db.scoutingEntry.updateMany({ where: { id: entryId, driveFolderId: null }, data: { driveFolderId: folderId } });
  if (!saved.count) {
    const now = await db.scoutingEntry.findUnique({ where: { id: entryId }, select: { driveFolderId: true } });
    return now?.driveFolderId ? { status: "exists", folderId: now.driveFolderId } : { status: "gone" };
  }
  await logAudit(db, {
    actorId,
    entity: "ScoutingEntry",
    entityId: entryId,
    summary: status === "made" ? `Drive folder made: ${ACCOMMODATION} › ${name}` : `Drive folder linked: the existing ${ACCOMMODATION} › ${found!.name}`,
  });
  return { status, folderId };
}

/** After a rename: every event folder of the property follows the new name. */
export async function renamePropertyFolders(db: Db, propertyId: string, drive: DriveApi | null = googleDrive()) {
  if (!drive) return 0;
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { name: true, scoutingEntries: { where: { driveFolderId: { not: null } }, select: { driveFolderId: true } } } });
  if (!property) return 0;
  for (const entry of property.scoutingEntries) await drive.rename(entry.driveFolderId!, folderName(property.name));
  return property.scoutingEntries.length;
}

/** Never lets Drive trouble reach the person: logged, and the hourly run tries again. */
export async function quietly<T>(what: string, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    console.error(`[drive] ${what}:`, error);
    return null;
  }
}

/**
 * The hourly run's catch-up: properties put on an event in the last week
 * whose folder was not made (Drive was down, or the event's folder was set
 * afterwards). Older ones are left — "new properties only" (the owner
 * 2026-11-20); the panel's Make Drive folder covers them.
 */
export async function catchUpFolders(db: PrismaClient, drive: DriveApi | null = googleDrive(), at = new Date()) {
  if (!drive) return { made: 0, skipped: "off" as const };
  const entries = await db.scoutingEntry.findMany({
    where: {
      driveFolderId: null,
      event: { driveFolderId: { not: null } },
      // Ten minutes' grace, so the immediate attempt is not raced.
      createdAt: { gte: new Date(at.getTime() - 7 * 864e5), lte: new Date(at.getTime() - 10 * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: { id: true },
  });
  let made = 0;
  for (const entry of entries) {
    const outcome = await quietly(`catch-up ${entry.id}`, () => ensureEntryFolder(db, entry.id, drive));
    if (outcome && (outcome.status === "made" || outcome.status === "linked")) made++;
  }
  return { made };
}

/**
 * Do it once the person has their answer (Next's after()): the folder is made
 * after the request, so a slow Drive never holds anyone up, and a failure
 * leaves it to the hourly catch-up. Outside a request (a script), it just runs.
 */
export function soon(what: string, run: () => Promise<unknown>) {
  const go = () => quietly(what, run);
  try {
    after(go);
  } catch {
    void go();
  }
}

/** A property was just put on an event: its folder, soon. */
export function folderSoon(entryId: string, actorId: string | null) {
  soon(`folder for ${entryId}`, async () => {
    const { db } = await import("~/server/db");
    return ensureEntryFolder(db, entryId, googleDrive(), actorId);
  });
}

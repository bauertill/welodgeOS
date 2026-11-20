import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: {} }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));

import { ACCOMMODATION, ensureEntryFolder, folderIdFrom, SUBFOLDERS, type DriveApi } from "~/server/drive";

/** A shared drive in memory: folders by id, each with a parent. */
function fakeDrive(seed: { id: string; name: string; parent: string }[] = []) {
  const folders = [...seed];
  let n = 0;
  const api: DriveApi = {
    folders: async (parent) => folders.filter((f) => f.parent === parent).map(({ id, name }) => ({ id, name })),
    createFolder: async (parent, name) => {
      const id = `new${++n}`;
      folders.push({ id, name, parent });
      return id;
    },
    rename: async (id, name) => {
      folders.find((f) => f.id === id)!.name = name;
    },
    folderName: async (id) => folders.find((f) => f.id === id)?.name ?? null,
  };
  return { api, folders };
}

/** Just enough of the database for one entry. */
function fakeDb(entry: { driveFolderId: string | null; eventFolder: string | null; name: string }) {
  const audits: string[] = [];
  const db = {
    scoutingEntry: {
      findUnique: async () => ({ driveFolderId: entry.driveFolderId, event: { driveFolderId: entry.eventFolder }, property: { name: entry.name } }),
      updateMany: async ({ data }: { data: { driveFolderId: string } }) => {
        if (entry.driveFolderId) return { count: 0 };
        entry.driveFolderId = data.driveFolderId;
        return { count: 1 };
      },
    },
    auditEntry: { create: async ({ data }: { data: { summary: string } }) => audits.push(data.summary) },
  };
  return { db: db as never, entry, audits };
}

describe("folder links", () => {
  it("reads the id from a pasted link or a bare id", () => {
    expect(folderIdFrom("https://drive.google.com/drive/folders/1FrQCwUsBz2ihgJudw7vDFWi9A_VLGTiE?usp=sharing")).toBe("1FrQCwUsBz2ihgJudw7vDFWi9A_VLGTiE");
    expect(folderIdFrom("https://drive.google.com/open?id=1FrQCwUsBz2ihgJudw7vDFWi9A_VLGTiE")).toBe("1FrQCwUsBz2ihgJudw7vDFWi9A_VLGTiE");
    expect(folderIdFrom("1FrQCwUsBz2ihgJudw7vDFWi9A_VLGTiE")).toBe("1FrQCwUsBz2ihgJudw7vDFWi9A_VLGTiE");
    expect(folderIdFrom("not a link")).toBeNull();
  });
});

describe("a property put on an event", () => {
  it("gets <event> › 1_Accommodation › <property> with the five subfolders", async () => {
    const drive = fakeDrive([
      { id: "ev", name: "10_FIFA Women's World Cup 2027", parent: "root" },
      { id: "acc", name: ACCOMMODATION, parent: "ev" },
    ]);
    const { db, entry, audits } = fakeDb({ driveFolderId: null, eventFolder: "ev", name: "Othon Palace Copacabana Rio" });
    const outcome = await ensureEntryFolder(db, "e1", drive.api);
    expect(outcome.status).toBe("made");
    const made = drive.folders.find((f) => f.name === "Othon Palace Copacabana Rio")!;
    expect(made.parent).toBe("acc");
    expect(drive.folders.filter((f) => f.parent === made.id).map((f) => f.name)).toEqual(SUBFOLDERS);
    expect(entry.driveFolderId).toBe(made.id);
    expect(audits[0]).toContain("Drive folder made");
  });

  it("uses a folder already there under its name, whatever the case", async () => {
    const drive = fakeDrive([
      { id: "ev", name: "1_SOL28", parent: "root" },
      { id: "acc", name: "1_Accommodation", parent: "ev" },
      { id: "dec", name: "decron ", parent: "acc" },
    ]);
    const { db, entry } = fakeDb({ driveFolderId: null, eventFolder: "ev", name: "Decron" });
    expect((await ensureEntryFolder(db, "e1", drive.api)).status).toBe("linked");
    expect(entry.driveFolderId).toBe("dec");
    expect(drive.folders).toHaveLength(3);
  });

  it("makes 1_Accommodation when the event folder lacks it", async () => {
    const drive = fakeDrive([{ id: "ev", name: "17_UEFA", parent: "root" }]);
    const { db } = fakeDb({ driveFolderId: null, eventFolder: "ev", name: "Hotel A" });
    await ensureEntryFolder(db, "e1", drive.api);
    expect(drive.folders.find((f) => f.name === ACCOMMODATION)?.parent).toBe("ev");
  });

  it("does nothing without Drive, without the event's folder, or when it already has one", async () => {
    const drive = fakeDrive([{ id: "ev", name: "E", parent: "root" }]);
    expect((await ensureEntryFolder(fakeDb({ driveFolderId: null, eventFolder: "ev", name: "A" }).db, "e1", null)).status).toBe("off");
    expect((await ensureEntryFolder(fakeDb({ driveFolderId: null, eventFolder: null, name: "A" }).db, "e1", drive.api)).status).toBe("no-event-folder");
    expect((await ensureEntryFolder(fakeDb({ driveFolderId: "x", eventFolder: "ev", name: "A" }).db, "e1", drive.api)).status).toBe("exists");
    expect(drive.folders).toHaveLength(1);
  });
});

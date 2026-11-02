"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { Card, EmptyState } from "~/app/_components/ui";
import { factSheetPath, fileSizeWords, MAX_FACT_SHEET_BYTES } from "~/lib/fact-sheets";
import { formatDate, formatMomentInWords } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * Fact sheets for the newsletter (doc §4.12): PDFs whose private link — put
 * behind the download button in a mailer — asks for an email, then hands over
 * the file; and who downloaded which, on the fact sheet and on the client.
 */

type Sheet = NonNullable<RouterOutputs["factSheet"]["byId"]>;

/** The page's own address, known only in the browser: staging's on staging, the live site's on the live site. */
function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="text-brand-700 text-[13px] font-medium hover:underline"
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}

// --- The list -------------------------------------------------------------------

export function FactSheetList() {
  const sheets = api.factSheet.list.useQuery();
  const origin = useOrigin();
  const [adding, setAdding] = useState(false);
  const rows = sheets.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setAdding(true)}>
          + Add a fact sheet
        </Button>
      </div>
      {rows.length === 0 ? (
        sheets.isLoading ? (
          <p className="text-ink-500 text-sm font-light">Loading…</p>
        ) : (
          <EmptyState
            title="No fact sheets yet"
            description="Add a PDF, copy its link, and put it behind the download button in your newsletter. Readers give their email to download it, and you see who did — on the fact sheet and on the client's page."
          />
        )
      ) : (
        <Card>
          <ul className="divide-ink-200/60 divide-y">
            {rows.map((sheet) => (
              <li key={sheet.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/fact-sheets/${sheet.id}`} className="text-ink-900 hover:text-brand-700 text-sm font-medium">
                    {sheet.title}
                  </Link>
                  <span className="text-ink-500 block text-xs font-light">
                    {[
                      sheet.fileUrl ? `PDF${sheet.fileSize ? ` · ${fileSizeWords(sheet.fileSize)}` : ""}` : "Link to the PDF",
                      `added ${formatDate(sheet.createdAt)}${sheet.createdBy?.name ? ` by ${sheet.createdBy.name}` : ""}`,
                      sheet.lastDownload ? `last downloaded ${formatMomentInWords(sheet.lastDownload)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-ink-700 text-[13px]">
                    <span className="text-ink-900 font-semibold">{sheet.downloads}</span> {sheet.downloads === 1 ? "download" : "downloads"}
                    {sheet.readers !== sheet.downloads && <span className="text-ink-500 font-light"> · {sheet.readers} people</span>}
                  </span>
                  {sheet.token ? (
                    origin && <CopyLink url={`${origin}${factSheetPath(sheet.token)}`} />
                  ) : (
                    <span className="text-ink-400 text-xs">Link off</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {adding && <FactSheetPopup onClose={() => setAdding(false)} />}
    </div>
  );
}

// --- Adding or changing one -------------------------------------------------------

type FileChoice = { kind: "upload"; fileUrl: string; fileName: string; fileSize: number } | { kind: "link"; linkUrl: string };

/** The title, a line for the reader, and the PDF — uploaded, or a link to it. */
function FactSheetPopup({ sheet, onClose }: { sheet?: Sheet; onClose: () => void }) {
  const router = useRouter();
  const utils = api.useUtils();
  const canUpload = api.factSheet.canUpload.useQuery();
  const [title, setTitle] = useState(sheet?.title ?? "");
  const [description, setDescription] = useState(sheet?.description ?? "");
  const [how, setHow] = useState<"upload" | "link">(sheet?.linkUrl ? "link" : "upload");
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState(sheet?.linkUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const done = (id: string) => {
    void utils.factSheet.invalidate();
    router.refresh();
    onClose();
    if (!sheet) router.push(`/fact-sheets/${id}`);
  };
  const create = api.factSheet.create.useMutation({ onSuccess: (created) => done(created.id) });
  const update = api.factSheet.update.useMutation({ onSuccess: (updated) => done(updated.id) });
  const uploadOn = canUpload.data === true;
  const mode = uploadOn ? how : "link";
  const pending = uploading || create.isPending || update.isPending;

  const save = async () => {
    setProblem(null);
    if (!title.trim()) return setProblem("Give the fact sheet a title.");
    let choice: FileChoice | undefined;
    if (mode === "upload" && file) {
      if (file.type !== "application/pdf") return setProblem("Choose a PDF.");
      if (file.size > MAX_FACT_SHEET_BYTES) return setProblem("That PDF is over 50 MB.");
      setUploading(true);
      try {
        const blob = await upload(`fact-sheets/${file.name}`, file, { access: "public", handleUploadUrl: "/api/fact-sheets/upload", contentType: "application/pdf" });
        choice = { kind: "upload", fileUrl: blob.url, fileName: file.name, fileSize: file.size };
      } catch (error) {
        setUploading(false);
        return setProblem(error instanceof Error ? error.message : "The upload failed.");
      }
      setUploading(false);
    } else if (mode === "link" && linkUrl.trim() && linkUrl.trim() !== sheet?.linkUrl) {
      choice = { kind: "link", linkUrl: linkUrl.trim() };
    }
    if (!sheet && !choice) return setProblem(mode === "upload" ? "Choose the PDF to upload." : "Paste the link to the PDF.");
    if (sheet) update.mutate({ id: sheet.id, title, description, file: choice });
    else create.mutate({ title, description, file: choice! });
  };

  return (
    <Popup
      size="medium"
      title={sheet ? "Change the fact sheet" : "Add a fact sheet"}
      subtitle="Readers see the title and the line under it, give their email, and get the PDF."
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="LA28 accommodation fact sheet" autoFocus />
        </Field>
        <Field label="A line for the reader — optional">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Where our teams stay for the 2028 Games, and what it costs." />
        </Field>
        {uploadOn && (
          <div className="flex gap-2 text-[13px]">
            {(["upload", "link"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setHow(option)}
                className={`rounded-full border px-3 py-1 ${how === option ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-700"}`}
              >
                {option === "upload" ? "Upload the PDF" : "Link to it"}
              </button>
            ))}
          </div>
        )}
        {mode === "upload" ? (
          <Field label={sheet?.fileName ? `The PDF — now ${sheet.fileName}; choose another to replace it` : "The PDF"}>
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-ink-700 block w-full text-sm" />
          </Field>
        ) : (
          <Field
            label="Link to the PDF"
            hint={
              canUpload.data === false
                ? "Uploading is not switched on yet, so the PDF stays where it is — Dropbox or Google Drive, shared so anyone with the link can open it. Readers only get the link after giving their email."
                : "Dropbox or Google Drive, shared so anyone with the link can open it. Readers only get it after giving their email."
            }
          >
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://www.dropbox.com/…" />
          </Field>
        )}
        <FormError message={problem ?? (create.error ? friendlyError(create.error) : update.error ? friendlyError(update.error) : null)} />
        <div className="flex gap-2">
          <Button type="button" onClick={() => void save()} disabled={pending}>
            {uploading ? "Uploading…" : pending ? "Saving…" : sheet ? "Save" : "Add the fact sheet"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Popup>
  );
}

// --- One fact sheet -------------------------------------------------------------

export function FactSheetView({ id }: { id: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const sheet = api.factSheet.byId.useQuery({ id });
  const origin = useOrigin();
  const [editing, setEditing] = useState(false);
  const changed = () => void utils.factSheet.invalidate();
  const setLink = api.factSheet.setLink.useMutation({ onSuccess: changed });
  const remove = api.factSheet.remove.useMutation({
    onSuccess: () => {
      void utils.factSheet.invalidate();
      router.push("/fact-sheets");
    },
  });
  if (!sheet.data) return <p className="text-ink-500 text-sm font-light">{sheet.isLoading ? "Loading…" : "This fact sheet is not here any more."}</p>;
  const data = sheet.data;
  const url = data.token && origin ? `${origin}${factSheetPath(data.token)}` : null;
  const known = data.downloads.filter((download) => download.who?.contact);
  const people = new Set(data.downloads.map((download) => download.email)).size;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-ink-900 text-xl font-semibold">{data.title}</h1>
            {data.description && <p className="text-ink-700 mt-1 text-sm font-light">{data.description}</p>}
            <p className="text-ink-500 mt-2 text-xs font-light">
              {data.fileUrl ? (
                <a href={data.fileUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                  {data.fileName ?? "The PDF"}
                </a>
              ) : (
                <a href={data.linkUrl ?? "#"} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                  The PDF, by its link ↗
                </a>
              )}
              {data.fileSize ? ` · ${fileSizeWords(data.fileSize)}` : ""} · added {formatDate(data.createdAt)}
              {data.createdBy?.name ? ` by ${data.createdBy.name}` : ""}
            </p>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-light hover:underline">
            Change
          </button>
        </div>

        <div className="border-ink-200/60 mt-4 border-t pt-4">
          <p className="text-ink-900 text-[13px] font-medium">Link for the download button</p>
          {data.token ? (
            <>
              <p className="text-ink-500 mt-1 text-xs font-light">
                Put this behind the download button in your newsletter. It opens a page with the title, a box for their email and a Download button — nothing
                else of ours.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="bg-ink-50 text-ink-700 max-w-full truncate rounded px-2 py-1 text-xs">{url ?? "…"}</code>
                {url && <CopyLink url={url} />}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="text-brand-700 text-[13px] font-light hover:underline">
                    See what they see ↗
                  </a>
                )}
                <button type="button" disabled={setLink.isPending} onClick={() => setLink.mutate({ id: data.id, on: false })} className="text-xs font-light text-[#c03654] hover:underline">
                  Switch off
                </button>
              </div>
            </>
          ) : (
            <p className="text-ink-500 mt-1 text-xs font-light">
              Switched off — the link in any newsletter already sent now says it is no longer in use.{" "}
              <button type="button" disabled={setLink.isPending} onClick={() => setLink.mutate({ id: data.id, on: true })} className="text-brand-700 font-medium hover:underline">
                Make a new link
              </button>
            </p>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-ink-900 mb-1 text-[15px] font-medium">
          Downloads <span className="text-ink-500 font-light">· {data.downloads.length}</span>
        </h2>
        <p className="text-ink-500 mb-3 text-xs font-light">
          {data.downloads.length
            ? `${people} ${people === 1 ? "person" : "people"}, ${known.length ? `${new Set(known.map((d) => d.email)).size} of them our contacts` : "none of them our contacts yet"}. An email nobody has yet is kept as a lead: add them as a contact and this and anything else they downloaded shows on their client's page.`
            : "None yet."}
        </p>
        {data.downloads.length > 0 && (
          <ul className="divide-ink-200/60 divide-y">
            {data.downloads.map((download) => (
              <DownloadRow key={download.id} download={download} />
            ))}
          </ul>
        )}
      </Card>

      <p className="px-1">
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete “${data.title}”?`)) remove.mutate({ id: data.id });
          }}
          className="text-[13px] font-light text-[#c03654] hover:underline"
        >
          Delete this fact sheet
        </button>
        {remove.error && <FormError message={friendlyError(remove.error)} />}
      </p>
      {editing && <FactSheetPopup sheet={data} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** One download: the email, when, and who it is — a contact, someone at a client, or a lead to add. */
function DownloadRow({ download }: { download: Sheet["downloads"][number] }) {
  const [adding, setAdding] = useState(false);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 text-sm">
        {download.who?.contact ? (
          <>
            <span className="text-ink-900 font-medium">{download.who.contact.name}</span>{" "}
            <Link href={`/clients/${download.who.client.id}`} className="text-brand-700 hover:underline">
              {download.who.client.name}
            </Link>
            <span className="text-ink-500 block text-xs font-light">{download.email}</span>
          </>
        ) : (
          <>
            <span className="text-ink-900 font-medium">{download.email}</span>
            <span className="text-ink-500 block text-xs font-light">
              {download.who ? (
                <>
                  Not a contact yet — at{" "}
                  <Link href={`/clients/${download.who.client.id}`} className="text-brand-700 hover:underline">
                    {download.who.client.name}
                  </Link>
                  , by their email
                </>
              ) : (
                "Not in the CRM yet"
              )}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-ink-500 text-xs font-light">{formatMomentInWords(download.createdAt)}</span>
        {!download.who?.contact && (
          <button type="button" onClick={() => setAdding(true)} className="text-brand-700 text-xs font-medium hover:underline">
            Add as contact
          </button>
        )}
      </div>
      {adding && <AddReader email={download.email} clientId={download.who?.client.id} onClose={() => setAdding(false)} />}
    </li>
  );
}

/** A reader made a client's contact, in two fields: which client, and their name. */
function AddReader({ email, clientId: suggested, onClose }: { email: string; clientId?: string; onClose: () => void }) {
  const utils = api.useUtils();
  const clients = api.clients.list.useQuery();
  const [clientId, setClientId] = useState(suggested ?? "");
  const [name, setName] = useState("");
  const save = api.clients.saveContact.useMutation({
    onSuccess: () => {
      void utils.factSheet.invalidate();
      void utils.clients.invalidate();
      onClose();
    },
  });
  return (
    <Popup size="medium" title="Add as a contact" subtitle={email} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Client" hint="A company not in the CRM yet is added under Sales → Clients first.">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choose the client</option>
            {(clients.data ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" autoFocus />
        </Field>
        <FormError message={save.error ? friendlyError(save.error) : null} />
        <div className="flex gap-2">
          <Button type="button" disabled={!clientId || !name.trim() || save.isPending} onClick={() => save.mutate({ clientId, contact: { name, email } })}>
            {save.isPending ? "Adding…" : "Add the contact"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Popup>
  );
}

// --- On the client's page -----------------------------------------------------------

/** What the client's people downloaded from the newsletter (doc §4.12) — contacts, and others at their email domain. */
export function ClientFactSheets({ clientId }: { clientId: string }) {
  const downloads = api.factSheet.forClient.useQuery({ clientId });
  const rows = downloads.data ?? [];
  if (!rows.length) return null;
  return (
    <Card>
      <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Fact sheets downloaded</h2>
      <ul className="space-y-2.5">
        {rows.map((download) => (
          <li key={download.id} className="text-sm">
            <span className="text-ink-900 font-medium">{download.who?.contact?.name ?? download.email}</span>{" "}
            <span className="text-ink-700 font-light">downloaded</span>{" "}
            <Link href={`/fact-sheets/${download.factSheet.id}`} className="text-brand-700 hover:underline">
              {download.factSheet.title}
            </Link>
            <span className="text-ink-500 block text-xs font-light">
              {formatDate(download.createdAt)}
              {!download.who?.contact && " · not a contact yet, by their email"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- The download page, for a newsletter reader -------------------------------------------

export function DownloadForm({ token }: { token: string }) {
  const page = api.factSheet.page.useQuery({ token }, { retry: false });
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const download = api.factSheet.download.useMutation({
    onSuccess: ({ url }) => {
      setDone(url);
      window.location.href = url;
    },
  });
  if (page.error) return <p className="text-ink-700 text-center text-sm font-light">This link is not in use any more.</p>;
  if (!page.data) return <p className="text-ink-500 text-center text-sm font-light">Loading…</p>;
  return (
    <Card>
      <h1 className="text-ink-900 text-xl font-semibold">{page.data.title}</h1>
      {page.data.description && <p className="text-ink-700 mt-2 text-sm font-light">{page.data.description}</p>}
      {done ? (
        <p className="text-ink-700 mt-5 text-sm font-light">
          Your download is starting. If it does not,{" "}
          <a href={done} className="text-brand-700 font-medium hover:underline">
            open the PDF here
          </a>
          .
        </p>
      ) : (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            download.mutate({ token, email });
          }}
        >
          <Field label="Your email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="email" />
          </Field>
          <FormError message={download.error ? friendlyError(download.error) : null} />
          <Button type="submit" disabled={download.isPending}>
            {download.isPending ? "One moment…" : "Download"}
          </Button>
        </form>
      )}
    </Card>
  );
}

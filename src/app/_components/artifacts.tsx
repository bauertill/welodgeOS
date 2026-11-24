"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { formatDate } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * Artifacts (doc §4.13): pages the team has Claude make — a presentation, a
 * comparison, a proposal — kept here, and shown to a client by a link at
 * os.welodge.net/p/… once shared. Made by Claude through the We Lodge OS
 * connector, or uploaded as an HTML file.
 */

type Artifact = NonNullable<RouterOutputs["artifact"]["byId"]>;
type Row = RouterOutputs["artifact"]["list"][number];

const clientUrl = (token: string) => `${window.location.origin}/p/${token}`;
const who = (person?: { name: string | null; email: string | null } | null) => person?.name ?? person?.email ?? "someone";
const when = (date: Date) => `${formatDate(date)} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
const MAX = 4_000_000;

/** An .html file picked from the computer, read as text. */
async function readHtmlFile(file: File): Promise<{ html: string } | { problem: string }> {
  if (!/\.html?$/i.test(file.name) && file.type !== "text/html") return { problem: "Choose an HTML file (.html) — in Claude, download the artifact as HTML." };
  if (file.size > MAX) return { problem: "That page is over 4 MB — move pictures to links, or make it smaller." };
  return { html: await file.text() };
}

/** Sales › Artifacts: every artifact, last changed first. */
export function ArtifactList() {
  const utils = api.useUtils();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const list = api.artifact.list.useQuery({ archived, q });
  const [making, setMaking] = useState(false);
  const [sharing, setSharing] = useState<Row | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const archive = api.artifact.archive.useMutation({ onSuccess: () => void utils.artifact.invalidate() });

  const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2.5 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
  const td = "border-ink-200/40 border-b px-3 py-2.5 align-top text-[13px] font-light";
  const action = "text-brand-700 text-xs whitespace-nowrap hover:underline";

  return (
    <div className="space-y-4">
      <div className="border-brand-200 bg-brand-50/60 rounded-xl border px-5 py-4 text-[13px] font-light">
        <p className="text-ink-900 font-medium">Have Claude make it</p>
        <p className="text-ink-700 mt-1">
          In Claude, with the We Lodge OS connector on, ask for the page and say to save it to OS — e.g. <i>“Make a one-page comparison of the three hotels for Belgium NOC and save it to OS as an artifact.”</i> It lands
          here. Ask Claude to share it and it gives you the client&apos;s link, or turn the link on here. Made the page somewhere else? Upload it as an HTML file with + New artifact.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or who it is for" aria-label="Search artifacts" className="max-w-xs" />
        <label className="text-ink-700 flex items-center gap-2 text-[13px] font-light">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="accent-brand-500" />
          Show archived
        </label>
        <span className="ml-auto">
          <Button type="button" onClick={() => setMaking(true)}>
            + New artifact
          </Button>
        </span>
      </div>
      <FormError message={archive.error ? friendlyError(archive.error) : null} />
      {list.isLoading ? (
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      ) : !list.data?.length ? (
        <p className="text-ink-500 text-sm font-light">{archived ? "Nothing archived." : q ? "Nothing matches." : "No artifacts yet. Ask Claude to make one and save it to OS, or upload one with + New artifact."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className={`${th} pl-4`}>Artifact</th>
                <th className={th}>For</th>
                <th className={th}>Event</th>
                <th className={th}>Last changed</th>
                <th className={th}>Client link</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.data.map((row) => (
                <tr key={row.id} className="hover:bg-brand-50/40">
                  <td className={`${td} text-ink-900 pl-4`}>
                    <Link href={`/artifacts/${row.id}`} className="hover:text-brand-700 font-medium">
                      {row.title}
                    </Link>
                    {row.description && <span className="text-ink-500 block text-xs font-light">{row.description}</span>}
                  </td>
                  <td className={td}>{row.forLabel ?? "—"}</td>
                  <td className={td}>{row.event?.name ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {when(row.updatedAt)}
                    <span className="text-ink-500 block text-xs">{who(row.updatedBy ?? row.createdBy)}</span>
                  </td>
                  <td className={td}>
                    {row.shareEnabled && row.shareToken ? (
                      <button type="button" className={action} onClick={() => void navigator.clipboard.writeText(clientUrl(row.shareToken!)).then(() => setCopied(row.id))}>
                        {copied === row.id ? "Copied" : "Copy link"}
                      </button>
                    ) : (
                      <span className="text-ink-500">Not shared</span>
                    )}
                    {!row.archived && (
                      <button type="button" className="text-ink-500 ml-2 text-xs hover:underline" onClick={() => setSharing(row)}>
                        Manage
                      </button>
                    )}
                  </td>
                  <td className={`${td} space-x-3 text-right whitespace-nowrap`}>
                    {!row.archived && (
                      <Link href={`/artifacts/${row.id}`} className={action}>
                        Open
                      </Link>
                    )}
                    <button
                      type="button"
                      className={action}
                      onClick={() => {
                        if (row.archived) archive.mutate({ id: row.id, archived: false });
                        else if (window.confirm(`Archive "${row.title}"? Its client link stops working; it can be brought back from Show archived.`)) archive.mutate({ id: row.id, archived: true });
                      }}
                    >
                      {row.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {making && <NewArtifact onClose={() => setMaking(false)} />}
      {sharing && (
        <ShareArtifact
          id={sharing.id}
          initial={{ shareEnabled: sharing.shareEnabled, shareToken: sharing.shareToken }}
          onClose={() => {
            setSharing(null);
            void utils.artifact.invalidate();
          }}
        />
      )}
    </div>
  );
}

/** Title, who it is for, the event — the same boxes for a new one and for editing. */
function DetailFields({
  values,
  onChange,
}: {
  values: { title: string; forLabel: string; description: string; eventId: string };
  onChange: (values: { title: string; forLabel: string; description: string; eventId: string }) => void;
}) {
  const events = api.event.list.useQuery();
  return (
    <>
      <Field label="Title">
        <Input value={values.title} onChange={(e) => onChange({ ...values, title: e.target.value })} placeholder="Decron – staggered lease comparison" autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="For">
          <Input value={values.forLabel} onChange={(e) => onChange({ ...values, forLabel: e.target.value })} placeholder="Decron Properties" />
        </Field>
        <Field label="Event">
          <Select value={values.eventId} onChange={(e) => onChange({ ...values, eventId: e.target.value })} aria-label="Event">
            <option value="">None</option>
            {(events.data ?? []).map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="What it is (for the list)">
        <Input value={values.description} onChange={(e) => onChange({ ...values, description: e.target.value })} placeholder="Three lease options side by side, for the provider" />
      </Field>
    </>
  );
}

function NewArtifact({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState({ title: "", forLabel: "", description: "", eventId: "" });
  const [html, setHtml] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const create = api.artifact.create.useMutation({ onSuccess: (row) => router.push(`/artifacts/${row.id}`) });
  return (
    <Popup size="medium" title="New artifact" subtitle="Upload a page as an HTML file — or paste its HTML. Most of the time, Claude saves pages here for you." onClose={onClose}>
      <form
        className="space-y-4 rounded-xl bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setProblem(null);
          if (!html.trim()) return setProblem("Choose an HTML file, or paste the page's HTML.");
          create.mutate({ ...values, eventId: values.eventId || null, html, note: fileName ? "uploaded" : "pasted" });
        }}
      >
        <DetailFields values={values} onChange={setValues} />
        <Field label="The page">
          <input
            type="file"
            accept=".html,.htm,text/html"
            aria-label="HTML file"
            className="text-ink-700 block text-[13px]"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void readHtmlFile(file).then((read) => {
                if ("problem" in read) return setProblem(read.problem);
                setProblem(null);
                setHtml(read.html);
                setFileName(file.name);
                if (!values.title.trim()) {
                  const title = /<title>([^<]{1,160})<\/title>/i.exec(read.html)?.[1]?.trim();
                  if (title) setValues((current) => ({ ...current, title }));
                }
              });
            }}
          />
        </Field>
        {!fileName && (
          <Field label="…or paste its HTML">
            <Textarea rows={4} value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<!doctype html>…" className="font-mono text-xs" />
          </Field>
        )}
        {fileName && <p className="text-ink-500 text-xs font-light">{fileName} — {Math.round(html.length / 1024)} KB</p>}
        <FormError message={problem ?? (create.error ? friendlyError(create.error) : null)} />
        <Button type="submit" disabled={!values.title.trim() || create.isPending}>
          {create.isPending ? "Saving…" : "Save the artifact"}
        </Button>
      </form>
    </Popup>
  );
}

/** The client's read-only link: on or off, copied, or replaced so the old one stops working. */
export function ShareArtifact({ id, initial, onClose }: { id: string; initial: { shareEnabled: boolean; shareToken: string | null }; onClose: () => void }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [state, setState] = useState(initial);
  const [copied, setCopied] = useState(false);
  const share = api.artifact.share.useMutation({
    onSuccess: (row) => {
      setState(row);
      setCopied(false);
      void utils.artifact.invalidate();
      router.refresh();
    },
  });
  const link = state.shareEnabled && state.shareToken ? clientUrl(state.shareToken) : null;
  return (
    <Popup size="medium" title="Share with the client" subtitle="A read-only page at os.welodge.net — anyone with the link can open it, it is not found by search engines, and it shows the latest page as it changes." onClose={onClose}>
      <div className="space-y-4 rounded-xl bg-white p-5 text-[13px]">
        {link ? (
          <>
            <Field label="The link">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => window.open(link, "_blank")}>
                Open it
              </Button>
              <Button type="button" variant="secondary" disabled={share.isPending} onClick={() => window.confirm("Make a new link? The current one stops working at once.") && share.mutate({ id, enabled: true, regenerate: true })}>
                New link
              </Button>
              <Button type="button" variant="danger" className="ml-auto" disabled={share.isPending} onClick={() => share.mutate({ id, enabled: false })}>
                Stop sharing
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-ink-700 font-light">Not shared. Check the page shows nothing the client should not see — our buying rates, margins or other clients — then turn the link on.</p>
            <Button type="button" disabled={share.isPending} onClick={() => share.mutate({ id, enabled: true })}>
              Turn on the client link
            </Button>
          </>
        )}
        <FormError message={share.error ? friendlyError(share.error) : null} />
      </div>
    </Popup>
  );
}

/** One artifact: the page itself, walled off from OS, with its link, a new page, and earlier versions. */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A new page each time it changes, so the frame reloads.
  const [stamp, setStamp] = useState(() => artifact.updatedAt.getTime());
  useEffect(() => setStamp(artifact.updatedAt.getTime()), [artifact.updatedAt]);
  const refresh = () => {
    void utils.artifact.invalidate();
    router.refresh();
  };
  const update = api.artifact.update.useMutation({ onSuccess: refresh });
  const restore = api.artifact.restore.useMutation({
    onSuccess: () => {
      setViewing(null);
      refresh();
    },
  });
  const src = viewing ? `/api/artifacts/${artifact.id}?version=${viewing}` : `/api/artifacts/${artifact.id}?t=${stamp}`;
  const link = artifact.shareEnabled && artifact.shareToken ? `/p/${artifact.shareToken}` : null;

  return (
    <div className="-mx-6 -my-8">
      <div className="border-ink-200/60 flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3 md:px-8">
        <Link href="/artifacts" className="text-ink-500 hover:text-brand-700 text-[13px]">
          ← All artifacts
        </Link>
        <div className="min-w-48 flex-1">
          <h1 className="text-ink-900 text-[15px] font-medium">{artifact.title}</h1>
          <p className="text-ink-500 text-xs font-light">
            {[artifact.forLabel && `For ${artifact.forLabel}`, artifact.event?.name, `changed ${when(artifact.updatedAt)} by ${who(artifact.updatedBy ?? artifact.createdBy)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-light hover:underline">
          Edit details
        </button>
        <label className="text-brand-700 cursor-pointer text-[13px] font-light hover:underline">
          Replace the page
          <input
            type="file"
            accept=".html,.htm,text/html"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void readHtmlFile(file).then((read) => {
                if ("problem" in read) return setProblem(read.problem);
                setProblem(null);
                if (window.confirm(`Replace the page with ${file.name}? The current one is kept as a version${link ? ", and the client's link shows the new one at once" : ""}.`)) update.mutate({ id: artifact.id, html: read.html, note: "uploaded" });
              });
            }}
          />
        </label>
        <a href={`/api/artifacts/${artifact.id}`} target="_blank" rel="noreferrer" className="text-brand-700 text-[13px] font-light hover:underline">
          Open full page ↗
        </a>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${link ? "bg-[#e6f6ec] text-[#1d6b3a]" : "bg-ink-50 text-ink-500"}`}>{link ? "Shared with the client" : "Not shared"}</span>
        <Button type="button" variant="secondary" onClick={() => setSharing(true)}>
          Client link
        </Button>
      </div>
      <FormError message={problem ?? (update.error ? friendlyError(update.error) : restore.error ? friendlyError(restore.error) : null)} />
      {viewing && (
        <div className="flex flex-wrap items-center gap-3 bg-[#fff4e0] px-4 py-2.5 text-[13px] text-[#8a5a00] md:px-8">
          <span className="font-medium">Version {viewing} — an earlier page, not what the client sees.</span>
          <button
            type="button"
            className="underline"
            disabled={restore.isPending}
            onClick={() => {
              const version = artifact.versions.find((one) => one.number === viewing);
              if (version && window.confirm(`Put version ${viewing} back as the current page? The current one is kept as a version.`)) restore.mutate({ id: artifact.id, versionId: version.id });
            }}
          >
            Put this version back
          </button>
          <button type="button" className="ml-auto underline" onClick={() => setViewing(null)}>
            Back to the current page
          </button>
        </div>
      )}
      <iframe
        key={src}
        src={src}
        title={artifact.title}
        // Walled off: the page's own scripts run, but it can read nothing of OS.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
        className="block h-[calc(100vh-8.5rem)] min-h-[32rem] w-full border-0 bg-white"
      />
      {artifact.versions.length > 0 && (
        <details className="border-ink-200/60 border-t bg-white px-4 py-3 text-[13px] md:px-8">
          <summary className="text-ink-500 cursor-pointer">▸ Earlier versions ({artifact.versions.length})</summary>
          <ul className="mt-2 space-y-1">
            {artifact.versions.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center gap-3">
                <span className="text-ink-700">Version {version.number}</span>
                <span className="text-ink-500 text-xs font-light">replaced {when(version.createdAt)} by {who(version.createdBy)}</span>
                <button type="button" className="text-brand-700 text-xs hover:underline" onClick={() => setViewing(version.number)}>
                  View
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {sharing && <ShareArtifact id={artifact.id} initial={{ shareEnabled: artifact.shareEnabled, shareToken: artifact.shareToken }} onClose={() => setSharing(false)} />}
      {editing && <EditDetails artifact={artifact} onClose={() => setEditing(false)} onSaved={refresh} />}
    </div>
  );
}

function EditDetails({ artifact, onClose, onSaved }: { artifact: Artifact; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState({ title: artifact.title, forLabel: artifact.forLabel ?? "", description: artifact.description ?? "", eventId: artifact.event?.id ?? "" });
  const update = api.artifact.update.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Popup size="medium" title="Edit details" onClose={onClose}>
      <form
        className="space-y-4 rounded-xl bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ id: artifact.id, ...values, eventId: values.eventId || null });
        }}
      >
        <DetailFields values={values} onChange={setValues} />
        <FormError message={update.error ? friendlyError(update.error) : null} />
        <Button type="submit" disabled={!values.title.trim() || update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </form>
    </Popup>
  );
}

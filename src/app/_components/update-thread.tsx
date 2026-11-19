"use client";

import type { UpdateKind } from "generated/prisma";
import Link from "next/link";
import { useState } from "react";

import { Button, Input } from "~/app/_components/form";
import { MentionTextarea } from "~/app/_components/mention-textarea";
import { Popup } from "~/app/_components/popup";
import { Initials } from "~/app/_components/property-groups";
import { dayKey, today } from "~/lib/dates";
import { formatDate, formatDay, formatMomentInWords } from "~/lib/format";
import { composeBody, isHeading, updateKindOrder, updateKinds } from "~/lib/update-kinds";
import { renderUpdateBody } from "~/lib/updates";
import { api, type RouterOutputs } from "~/trpc/react";

type Scope =
  | { propertyId: string; clientId?: undefined; salesRequestId?: undefined; providerId?: undefined; contractorId?: undefined }
  | { clientId: string; propertyId?: undefined; salesRequestId?: undefined; providerId?: undefined; contractorId?: undefined }
  | { salesRequestId: string; propertyId?: undefined; clientId?: undefined; providerId?: undefined; contractorId?: undefined }
  | { providerId: string; propertyId?: undefined; clientId?: undefined; salesRequestId?: undefined; contractorId?: undefined }
  | { contractorId: string; propertyId?: undefined; clientId?: undefined; salesRequestId?: undefined; providerId?: undefined };

export type UpdateRow = RouterOutputs["update"]["list"][number];

/**
 * The Updates feed (doc §2.6; called Feedback from 2026-10-01 to 2026-10-06): a running history of meeting notes and
 * feedback on a property or a client, with @mentions of colleagues. Newest
 * first, same convention as the inventory ledger; each update one line —
 * its kind, who, when and how it begins — opened on its own with Read more. An author can edit their
 * own post, which then says it was edited, and when.
 */
export function UpdateThread(scope: Scope) {
  const utils = api.useUtils();
  const updates = api.update.list.useQuery(scope);
  const people = api.user.list.useQuery();
  const [body, setBody] = useState("");
  const [extras, setExtras] = useState<Extras>(noExtras);
  // The box is a note; the other kinds open their template in a popup (doc §2.6).
  const [form, setForm] = useState<UpdateKind | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [happenedOn, setHappenedOn] = useState(dayKey(today()));
  const kinds = updateKindOrder.filter((option) => !updateKinds[option].propertyOnly || scope.propertyId);
  const template = form ? updateKinds[form] : null;
  const composed = form ? composeBody(form, answers) : "";
  const closeForm = () => {
    if (composed.trim() && !window.confirm("Close without posting? What you wrote is lost.")) return;
    setForm(null);
    setAnswers({});
    post.reset();
  };

  const post = api.update.post.useMutation({
    onSuccess: () => {
      setBody("");
      setAnswers({});
      setForm(null);
      setExtras(noExtras);
      void utils.update.invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <MentionTextarea
          value={body}
          onChange={setBody}
          people={people.data ?? []}
          placeholder="Write an update — @ to mention a colleague"
          // One line until something is typed, so an empty box takes no room.
          rows={body ? 3 : 1}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The other kinds, each a form in a popup; all land in the one feed below. */}
          <span className="flex flex-wrap items-center gap-1.5">
            {kinds
              .filter((option) => option !== "NOTE")
              .map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    post.reset();
                    setHappenedOn(dayKey(today()));
                    setForm(option);
                  }}
                  className="border-ink-200 text-ink-700 hover:border-brand-400 hover:text-brand-700 rounded-full border bg-white px-3 py-1 text-xs transition-colors"
                >
                  + {updateKinds[option].label}
                </button>
              ))}
          </span>
          {!form && post.error && <p className="text-xs text-[#c03654]">{post.error.message}</p>}
          {body.trim() && (
            <Button type="button" className="ml-auto" disabled={post.isPending} onClick={() => post.mutate({ ...scope, ...extrasInput(extras), body, kind: "NOTE" })}>
              {post.isPending ? "Posting…" : "Post update"}
            </Button>
          )}
        </div>
        {body.trim() && <UpdateExtras value={extras} onChange={setExtras} people={people.data ?? []} />}
      </div>

      {form && template && (
        <Popup title={template.label} subtitle="Shows in the updates with the rest." size="medium" onClose={closeForm}>
          <div className="border-ink-200/60 space-y-3 rounded-xl border bg-white p-5">
            <label className="flex items-center gap-2 text-[13px]">
              <span className="text-ink-700 font-medium">{template.short} on</span>
              <span className="w-40">
                <Input type="date" value={happenedOn} onChange={(e) => setHappenedOn(e.target.value)} aria-label="When it took place" />
              </span>
            </label>
            {template.sections.map((section, index) => (
              <div key={section.heading}>
                <span className="text-ink-700 mb-1 block text-[13px] font-medium">{section.heading}</span>
                <MentionTextarea
                  value={answers[section.heading] ?? ""}
                  onChange={(value) => setAnswers((current) => ({ ...current, [section.heading]: value }))}
                  people={people.data ?? []}
                  placeholder={section.placeholder}
                  rows={2}
                  autoFocus={index === 0}
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <UpdateExtras value={extras} onChange={setExtras} people={people.data ?? []} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            {post.error && <p className="text-xs text-[#c03654]">{post.error.message}</p>}
            <Button type="button" variant="ghost" className="ml-auto" onClick={closeForm}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!composed.trim() || post.isPending}
              onClick={() => post.mutate({ ...scope, ...extrasInput(extras), body: composed, kind: form, happenedOn: happenedOn || undefined })}
            >
              {post.isPending ? "Posting…" : `Post ${template.label.toLowerCase()}`}
            </Button>
          </div>
        </Popup>
      )}

      <UpdateList updates={updates.data} hide={scope} />
    </div>
  );
}

/**
 * A list of updates as cards, with Read more, replies and editing one's own
 * (doc §2.6) — the same on a property, chain, client or request page and on
 * the Updates board. `hide` leaves out the link to the page it is shown on.
 */
export function UpdateList({
  updates,
  hide,
  empty,
  hasMore,
  onMore,
  newSince,
}: {
  updates: UpdateRow[] | undefined;
  hide?: Partial<Record<"propertyId" | "clientId" | "salesRequestId" | "providerId" | "contractorId", string>>;
  empty?: string;
  /** On the board: more are loaded from the server, not shown ten at a time. */
  hasMore?: boolean;
  onMore?: () => void;
  /** Anything newer, written by someone else, is marked New. */
  newSince?: Date | null;
}) {
  const utils = api.useUtils();
  const people = api.user.list.useQuery();
  const me = api.user.me.useQuery();
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  // Every update as a card — its text cut to a few lines when long, each opened on its own.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(10);
  const shown = onMore ? (updates ?? []) : (updates ?? []).slice(0, limit);
  const more = (updates?.length ?? 0) - limit;
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const isNew = (entry: UpdateRow) => Boolean(newSince && entry.createdAt > newSince && entry.author?.id !== me.data?.id);

  const edit = api.update.edit.useMutation({
    onSuccess: () => {
      setEditing(null);
      void utils.update.invalidate();
    },
  });

  // A reply being written, under one update at a time (2026-11-17).
  const [replying, setReplying] = useState<{ id: string; body: string } | null>(null);
  const reply = api.update.reply.useMutation({
    onSuccess: () => {
      setReplying(null);
      void utils.update.invalidate();
    },
  });

  return (
    <>
      {updates && updates.length > 0 ? (
        <ul className="space-y-3">
          {shown.map((entry) => {
            const isOpen = open.has(entry.id) || editing?.id === entry.id;
            const textLines = entry.body.split("\n").filter((line) => line.trim() && !isHeading(entry.kind, line));
            // Easy to read at a glance (the team, 2026-11-17): the text shows, a long one cut to a few lines.
            const longer = textLines.length > 5 || textLines.join(" ").length > 420;
            const clipped = longer && !isOpen;
            const author = entry.author?.name ?? entry.author?.email ?? "—";
            return (
            <li key={entry.id} className="border-ink-200/60 flex gap-3 rounded-xl border bg-white px-4 py-3">
              {entry.author ? <Initials person={entry.author} /> : <span className="bg-ink-100 h-7 w-7 shrink-0 rounded-full" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-ink-900 text-[13px] font-semibold">{author}</span>
                  {entry.kind !== "NOTE" && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${updateKinds[entry.kind].badge}`}>{updateKinds[entry.kind].label}</span>
                  )}
                  <span className="text-ink-500 text-xs font-light" title={entry.createdAt.toLocaleString("en-CH")}>
                    {formatDay(entry.createdAt)}
                    {entry.happenedOn ? ` · ${updateKinds[entry.kind].short} on ${formatDate(entry.happenedOn)}` : ""}
                  </span>
                  {isNew(entry) && <span className="rounded-full bg-[#e0234e] px-1.5 text-[10px] leading-[16px] font-medium text-white">New</span>}
                  <UpdateTags entry={entry} hide={hide} />
                  {entry.author?.id === me.data?.id && editing?.id !== entry.id && (
                    <button
                      type="button"
                      onClick={() => {
                        edit.reset();
                        setEditing({ id: entry.id, body: entry.body });
                      }}
                      className="text-ink-500 hover:text-brand-700 ml-auto text-xs font-light transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editing?.id === entry.id ? (
                  <div className="mt-2">
                    <MentionTextarea
                      value={editing.body}
                      onChange={(value) => setEditing({ id: entry.id, body: value })}
                      people={people.data ?? []}
                      rows={4}
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      {edit.error && <p className="mr-auto text-xs text-[#c03654]">{edit.error.message}</p>}
                      <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button type="button" disabled={!editing.body.trim() || edit.isPending} onClick={() => edit.mutate(editing)}>
                        {edit.isPending ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`mt-1 ${clipped ? "max-h-[7.25rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" : ""}`}
                    >
                      {entry.kind === "NOTE" ? (
                        <p className="text-ink-800 text-sm leading-relaxed font-light whitespace-pre-line">{renderUpdateBody(entry.body)}</p>
                      ) : (
                        // A template: each heading shown as one, its answer beneath.
                        <div className="space-y-0.5 text-sm leading-relaxed font-light">
                          {entry.body.split("\n").map((line, index) =>
                            isHeading(entry.kind, line) ? (
                              <p key={index} className="text-ink-900 pt-1.5 text-[12px] font-medium first:pt-0">
                                {line}
                              </p>
                            ) : (
                              <p key={index} className="text-ink-800 min-h-[0.5rem] whitespace-pre-line">
                                {renderUpdateBody(line)}
                              </p>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                    {textLines.length === 0 && <p className="text-ink-500 mt-1 text-sm font-light italic">(empty)</p>}
                    {entry.fileUrl && (
                      <a href={entry.fileUrl} target="_blank" rel="noreferrer" className="text-brand-700 mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline">
                        📎 Open the file ↗
                      </a>
                    )}
                    <div className="mt-1 flex items-center gap-3">
                      {longer && (
                        <button type="button" onClick={() => toggle(entry.id)} className="text-brand-700 text-xs font-medium hover:underline">
                          {isOpen ? "Show less" : "Read more"}
                        </button>
                      )}
                      {entry.editedAt && (
                        <span className="text-ink-500 text-[11px] font-light italic" title={entry.editedAt.toLocaleString("en-CH")}>
                          Edited {formatMomentInWords(entry.editedAt)}
                        </span>
                      )}
                      {replying?.id !== entry.id && (
                        <button
                          type="button"
                          onClick={() => {
                            reply.reset();
                            setReplying({ id: entry.id, body: "" });
                          }}
                          className="text-ink-500 hover:text-brand-700 text-xs font-medium transition-colors"
                        >
                          Reply{entry.replies.length ? ` · ${entry.replies.length} ${entry.replies.length === 1 ? "reply" : "replies"}` : ""}
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* The replies, oldest first, then the box to add one (doc §2.6). */}
                {(entry.replies.length > 0 || replying?.id === entry.id) && (
                  <div className="border-ink-200/70 mt-3 space-y-3 border-l-2 pl-4">
                    {entry.replies.map((answer) => (
                      <div key={answer.id} className="flex gap-2.5">
                        {answer.author ? <Initials person={answer.author} /> : <span className="bg-ink-100 h-7 w-7 shrink-0 rounded-full" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-ink-900 text-[13px] font-semibold">{answer.author?.name ?? answer.author?.email ?? "—"}</span>
                            <span className="text-ink-500 text-xs font-light" title={answer.createdAt.toLocaleString("en-CH")}>
                              {formatDay(answer.createdAt)}
                            </span>
                            {answer.author?.id === me.data?.id && editing?.id !== answer.id && (
                              <button
                                type="button"
                                onClick={() => {
                                  edit.reset();
                                  setEditing({ id: answer.id, body: answer.body });
                                }}
                                className="text-ink-500 hover:text-brand-700 ml-auto text-xs font-light transition-colors"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                          {editing?.id === answer.id ? (
                            <div className="mt-1.5">
                              <MentionTextarea value={editing.body} onChange={(value) => setEditing({ id: answer.id, body: value })} people={people.data ?? []} rows={2} />
                              <div className="mt-2 flex items-center justify-end gap-2">
                                {edit.error && <p className="mr-auto text-xs text-[#c03654]">{edit.error.message}</p>}
                                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                                  Cancel
                                </Button>
                                <Button type="button" disabled={!editing.body.trim() || edit.isPending} onClick={() => edit.mutate(editing)}>
                                  {edit.isPending ? "Saving…" : "Save"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-ink-800 mt-0.5 text-sm leading-relaxed font-light whitespace-pre-line">{renderUpdateBody(answer.body)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {replying?.id === entry.id && (
                      <div>
                        <MentionTextarea
                          value={replying.body}
                          onChange={(value) => setReplying({ id: entry.id, body: value })}
                          people={people.data ?? []}
                          rows={2}
                          placeholder={`Reply to ${author.split(" ")[0]} — @ to mention a colleague`}
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                          {reply.error && <p className="mr-auto text-xs text-[#c03654]">{reply.error.message}</p>}
                          <Button type="button" variant="secondary" onClick={() => setReplying(null)}>
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            disabled={!replying.body.trim() || reply.isPending}
                            onClick={() => reply.mutate({ parentId: entry.id, body: replying.body })}
                          >
                            {reply.isPending ? "Posting…" : "Post reply"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
            );
          })}
          {(onMore ? hasMore : more > 0) && (
            <li>
              <button
                type="button"
                onClick={() => (onMore ? onMore() : setLimit((current) => current + 10))}
                className="text-brand-700 text-[13px] font-light hover:underline"
              >
                {onMore ? "Show older" : `Show ${Math.min(10, more)} older`}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm font-light">{empty ?? "No updates yet."}</p>
      )}
    </>
  );
}

/**
 * What an update is about, each a link to where its full history is (doc
 * §2.6): the property, the chain, the client, the request — and a provider
 * kept by name. The page it is shown on is left out.
 */
function UpdateTags({ entry, hide = {} }: { entry: UpdateRow; hide?: Partial<Record<"propertyId" | "clientId" | "salesRequestId" | "providerId" | "contractorId", string>> }) {
  const tag = "text-brand-700 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium hover:underline";
  return (
    <>
      {entry.property && entry.property.id !== hide.propertyId && (
        <Link href={`/properties/${entry.property.id}`} className={tag}>
          {entry.property.name}
        </Link>
      )}
      {entry.provider && entry.provider.id !== hide.providerId && (
        <Link href={`/providers/${entry.provider.id}`} className={tag}>
          {hide.propertyId ? `via ${entry.provider.name}` : entry.provider.name}
        </Link>
      )}
      {entry.contractor && entry.contractor.id !== hide.contractorId && (
        <Link href={`/contractors/${entry.contractor.id}`} className={tag}>
          {entry.contractor.name}
        </Link>
      )}
      {entry.client && entry.client.id !== hide.clientId && (
        <Link href={`/clients/${entry.client.id}`} className={tag}>
          {entry.client.name}
        </Link>
      )}
      {/* On a client's feed, an update written on one of its sales requests says which (doc §2.6). */}
      {entry.salesRequest && entry.salesRequest.id !== hide.salesRequestId && (
        <Link href={`/sales/${entry.salesRequest.id}`} className={tag}>
          {hide.clientId ? "" : `${entry.salesRequest.client.name} · `}
          {entry.salesRequest.event?.name ?? "sales"} request
        </Link>
      )}
      {entry.otherProvider && <span className="bg-ink-50 text-ink-700 rounded-full px-2 py-0.5 text-[11px] font-medium">{entry.otherProvider}</span>}
    </>
  );
}

/** Who else to tell, and a file to go with it (doc §2.6, §2.9). */
export type Extras = { notifyIds: string[]; fileUrl: string };
export const noExtras: Extras = { notifyIds: [], fileUrl: "" };
export const extrasInput = (extras: Extras) => ({ notifyIds: extras.notifyIds, fileUrl: extras.fileUrl.trim() || undefined });

export function UpdateExtras({
  value,
  onChange,
  people,
}: {
  value: Extras;
  onChange: (value: Extras) => void;
  people: { id: string; name: string | null; email: string | null }[];
}) {
  const [fileOpen, setFileOpen] = useState(Boolean(value.fileUrl));
  const chosen = people.filter((person) => value.notifyIds.includes(person.id));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-500 font-light">Notify</span>
      {chosen.map((person) => (
        <button
          key={person.id}
          type="button"
          onClick={() => onChange({ ...value, notifyIds: value.notifyIds.filter((id) => id !== person.id) })}
          className="bg-brand-50 text-brand-800 rounded-full px-2.5 py-1 font-medium"
          title="Click to leave them out"
        >
          {person.name ?? person.email} ×
        </button>
      ))}
      <select
        value=""
        onChange={(e) => e.target.value && onChange({ ...value, notifyIds: [...value.notifyIds, e.target.value] })}
        className="border-ink-200 text-ink-700 rounded-full border bg-white px-2.5 py-1"
        aria-label="Notify a colleague"
      >
        <option value="">+ colleague…</option>
        {people
          .filter((person) => !value.notifyIds.includes(person.id))
          .map((person) => (
            <option key={person.id} value={person.id}>
              {person.name ?? person.email}
            </option>
          ))}
      </select>
      {fileOpen ? (
        <input
          value={value.fileUrl}
          onChange={(e) => onChange({ ...value, fileUrl: e.target.value })}
          placeholder="Google Drive link — https://drive.google.com/…"
          aria-label="Link to a file"
          className="border-ink-200 min-w-64 flex-1 rounded-full border bg-white px-3 py-1 outline-none"
        />
      ) : (
        <button type="button" onClick={() => setFileOpen(true)} className="text-brand-700 font-medium hover:underline">
          📎 Add a file link
        </button>
      )}
    </div>
  );
}

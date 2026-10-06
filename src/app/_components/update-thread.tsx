"use client";

import type { UpdateKind } from "generated/prisma";
import { useState } from "react";

import { Button, Input } from "~/app/_components/form";
import { MentionTextarea } from "~/app/_components/mention-textarea";
import { Popup } from "~/app/_components/popup";
import { dayKey, today } from "~/lib/dates";
import { formatDate, formatDay, formatMomentInWords } from "~/lib/format";
import { composeBody, isHeading, updateKindOrder, updateKinds } from "~/lib/update-kinds";
import { renderUpdateBody } from "~/lib/updates";
import { api } from "~/trpc/react";

type Scope = { propertyId: string; clientId?: undefined } | { clientId: string; propertyId?: undefined };

/**
 * The Updates feed (doc §2.6; called Feedback from 2026-10-01 to 2026-10-06): a running history of meeting notes and
 * feedback on a property or a client, with @mentions of colleagues. Newest
 * first, same convention as the inventory ledger; only the latest shows
 * until "View more" opens the rest. An author can edit their
 * own post, which then says it was edited, and when.
 */
export function UpdateThread(scope: Scope) {
  const utils = api.useUtils();
  const updates = api.update.list.useQuery(scope);
  const people = api.user.list.useQuery();
  const me = api.user.me.useQuery();
  const [body, setBody] = useState("");
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
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  // Only the latest shows until asked: the feed only grows.
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? updates.data : updates.data?.slice(0, 1);
  const earlier = (updates.data?.length ?? 0) - 1;

  const edit = api.update.edit.useMutation({
    onSuccess: () => {
      setEditing(null);
      void utils.update.list.invalidate(scope);
    },
  });

  const post = api.update.post.useMutation({
    onSuccess: () => {
      setBody("");
      setAnswers({});
      setForm(null);
      void utils.update.list.invalidate(scope);
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
            <Button type="button" className="ml-auto" disabled={post.isPending} onClick={() => post.mutate({ ...scope, body, kind: "NOTE" })}>
              {post.isPending ? "Posting…" : "Post update"}
            </Button>
          )}
        </div>
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
          <div className="mt-4 flex items-center gap-2">
            {post.error && <p className="text-xs text-[#c03654]">{post.error.message}</p>}
            <Button type="button" variant="ghost" className="ml-auto" onClick={closeForm}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!composed.trim() || post.isPending}
              onClick={() => post.mutate({ ...scope, body: composed, kind: form, happenedOn: happenedOn || undefined })}
            >
              {post.isPending ? "Posting…" : `Post ${template.label.toLowerCase()}`}
            </Button>
          </div>
        </Popup>
      )}

      {updates.data && updates.data.length > 0 ? (
        <ul className="space-y-3">
          {shown!.map((entry) => (
            <li key={entry.id} className="border-ink-200/60 rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {entry.kind !== "NOTE" && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${updateKinds[entry.kind].badge}`}>{updateKinds[entry.kind].label}</span>
                  )}
                  <span className="text-ink-900 text-[13px] font-medium">{entry.author?.name ?? entry.author?.email ?? "—"}</span>
                  {entry.happenedOn && (
                    <span className="text-ink-500 text-xs font-light">
                      {updateKinds[entry.kind].short} on {formatDate(entry.happenedOn)}
                    </span>
                  )}
                </span>
                <span className="text-ink-500 flex items-baseline gap-3 text-xs font-light whitespace-nowrap">
                  {entry.author?.id === me.data?.id && editing?.id !== entry.id && (
                    <button
                      type="button"
                      onClick={() => {
                        edit.reset();
                        setEditing({ id: entry.id, body: entry.body });
                      }}
                      className="hover:text-brand-700 transition-colors"
                    >
                      Edit
                    </button>
                  )}
                  {formatDay(entry.createdAt)}
                </span>
              </div>

              {editing?.id === entry.id ? (
                <div className="mt-2">
                  <MentionTextarea
                    value={editing.body}
                    onChange={(value) => setEditing({ id: entry.id, body: value })}
                    people={people.data ?? []}
                    rows={3}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    {edit.error && (
                      <p className="mr-auto text-xs text-[#c03654]">{edit.error.message}</p>
                    )}
                    <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      disabled={!editing.body.trim() || edit.isPending}
                      onClick={() => edit.mutate(editing)}
                    >
                      {edit.isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {entry.kind === "NOTE" ? (
                    <p className="text-ink-700 mt-1 text-sm font-light whitespace-pre-line">{renderUpdateBody(entry.body)}</p>
                  ) : (
                    // A template: each heading shown as one, its answer beneath.
                    <div className="mt-1.5 space-y-0.5 text-sm font-light">
                      {entry.body.split("\n").map((line, index) =>
                        isHeading(entry.kind, line) ? (
                          <p key={index} className="text-ink-900 pt-1.5 text-[12px] font-medium first:pt-0">
                            {line}
                          </p>
                        ) : (
                          <p key={index} className="text-ink-700 min-h-[0.5rem] whitespace-pre-line">
                            {renderUpdateBody(line)}
                          </p>
                        ),
                      )}
                    </div>
                  )}
                  {entry.editedAt && (
                    <p
                      className="text-ink-500 mt-1 text-[11px] font-light italic"
                      title={entry.editedAt.toLocaleString("en-CH")}
                    >
                      Edited {formatMomentInWords(entry.editedAt)}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
          {earlier > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                className="text-brand-700 text-[13px] font-light hover:underline"
              >
                {showAll ? "Show only the latest" : `View more — ${earlier} earlier`}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm font-light">No updates yet.</p>
      )}
    </div>
  );
}

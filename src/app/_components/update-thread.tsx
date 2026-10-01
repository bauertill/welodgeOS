"use client";

import { useState } from "react";

import { Button } from "~/app/_components/form";
import { MentionTextarea } from "~/app/_components/mention-textarea";
import { formatDay, formatMomentInWords } from "~/lib/format";
import { renderUpdateBody } from "~/lib/updates";
import { api } from "~/trpc/react";

type Scope = { propertyId: string; clientId?: undefined } | { clientId: string; propertyId?: undefined };

/**
 * The Updates feed (doc §2.6): a running history of meeting notes and
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
          placeholder="Write an update and mention colleagues with @"
          rows={3}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          {post.error && (
            <p className="text-xs text-[#c03654]">{post.error.message}</p>
          )}
          <Button
            type="button"
            className="ml-auto"
            disabled={!body.trim() || post.isPending}
            onClick={() => post.mutate({ ...scope, body })}
          >
            {post.isPending ? "Posting…" : "Post update"}
          </Button>
        </div>
      </div>

      {updates.data && updates.data.length > 0 ? (
        <ul className="space-y-3">
          {shown!.map((entry) => (
            <li key={entry.id} className="border-ink-200/60 rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-900 text-[13px] font-medium">
                  {entry.author?.name ?? entry.author?.email ?? "—"}
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
                  <p className="text-ink-700 mt-1 text-sm font-light whitespace-pre-line">
                    {renderUpdateBody(entry.body)}
                  </p>
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
                {showAll ? "Show only the latest" : `View more — ${earlier} earlier ${earlier === 1 ? "update" : "updates"}`}
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

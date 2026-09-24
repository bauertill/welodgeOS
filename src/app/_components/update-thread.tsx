"use client";

import { useState } from "react";

import { Button } from "~/app/_components/form";
import { MentionTextarea } from "~/app/_components/mention-textarea";
import { formatDay } from "~/lib/format";
import { renderUpdateBody } from "~/lib/updates";
import { api } from "~/trpc/react";

type Scope = { propertyId: string; clientId?: undefined } | { clientId: string; propertyId?: undefined };

/**
 * The Updates feed (doc §2.6): a running, append-only history of meeting
 * notes and feedback on a property or a client, with @mentions of colleagues.
 * Newest first, same convention as the inventory ledger.
 */
export function UpdateThread(scope: Scope) {
  const utils = api.useUtils();
  const updates = api.update.list.useQuery(scope);
  const people = api.user.list.useQuery();
  const [body, setBody] = useState("");

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
          {updates.data.map((entry) => (
            <li key={entry.id} className="border-ink-200/60 rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-900 text-[13px] font-medium">
                  {entry.author?.name ?? entry.author?.email ?? "—"}
                </span>
                <span className="text-ink-500 text-xs font-light whitespace-nowrap">
                  {formatDay(entry.createdAt)}
                </span>
              </div>
              <p className="text-ink-700 mt-1 text-sm font-light whitespace-pre-line">
                {renderUpdateBody(entry.body)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-500 text-sm font-light">No updates yet.</p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { Card } from "~/app/_components/ui";
import { api, type RouterOutputs } from "~/trpc/react";

type Tag = RouterOutputs["teamTag"]["list"][number];

/**
 * Team tags (doc §2.7, the owner 2026-11-19): a name like LA and the people in
 * it. Writing @LA in an update, reply, task or comment tells every one of them,
 * by email too, as if each had been tagged by name. Anyone can make or change one.
 */
export function TeamTags() {
  const tags = api.teamTag.list.useQuery();
  const [editing, setEditing] = useState<Tag | "new" | null>(null);

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ink-900 text-[15px] font-medium">Team tags</h2>
          <p className="text-ink-500 mt-0.5 text-[13px] font-light">Tag a whole team at once: @LA in an update, task or comment tells everyone in it, by email too.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
          + New team tag
        </Button>
      </div>
      {tags.isLoading ? (
        <p className="text-ink-500 mt-4 text-sm font-light">Loading…</p>
      ) : !tags.data?.length ? (
        <p className="text-ink-500 mt-4 text-sm font-light">No team tags yet. Make one — LA, Sales, Acquisitions — and put its people in it.</p>
      ) : (
        <ul className="divide-ink-200/60 mt-4 divide-y">
          {tags.data.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-[13px]">
              <span className="text-brand-700 w-32 font-semibold">@{tag.name}</span>
              <span className="text-ink-700 min-w-0 flex-1 font-light">{tag.members.map((person) => person.name ?? person.email).join(", ")}</span>
              <button type="button" onClick={() => setEditing(tag)} className="text-brand-700 text-xs hover:underline">
                Change
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <TeamTagForm tag={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TeamTagForm({ tag, onClose }: { tag?: Tag; onClose: () => void }) {
  const utils = api.useUtils();
  const people = api.user.list.useQuery();
  const [name, setName] = useState(tag?.name ?? "");
  const [members, setMembers] = useState<Set<string>>(new Set(tag?.members.map((person) => person.id) ?? []));
  const done = () => {
    void utils.teamTag.invalidate();
    onClose();
  };
  const save = api.teamTag.save.useMutation({ onSuccess: done });
  const remove = api.teamTag.remove.useMutation({ onSuccess: done });
  const toggle = (id: string) => {
    const next = new Set(members);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMembers(next);
  };

  return (
    <Popup size="medium" title={tag ? `@${tag.name}` : "New team tag"} subtitle="Its name, typed after @, and the people it tells." onClose={onClose}>
      <form
        className="space-y-4 rounded-xl bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ id: tag?.id, name, memberIds: [...members] });
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="LA" autoFocus />
        </Field>
        <div>
          <p className="text-ink-700 mb-1 text-[13px] font-medium">Who is in it ({members.size})</p>
          <ul className="divide-ink-200/60 border-ink-200/60 max-h-[40vh] divide-y overflow-y-auto rounded-lg border">
            {(people.data ?? []).map((person) => (
              <li key={person.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px]">
                  <input type="checkbox" checked={members.has(person.id)} onChange={() => toggle(person.id)} className="accent-brand-500 h-4 w-4" />
                  <span className="text-ink-900">{person.name ?? person.email}</span>
                  {person.name && <span className="text-ink-500 text-xs font-light">{person.email}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <FormError message={friendlyError(save.error) ?? friendlyError(remove.error)} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!name.trim() || members.size === 0 || save.isPending}>
            {save.isPending ? "Saving…" : tag ? "Save team tag" : "Make team tag"}
          </Button>
          {tag && (
            <Button
              type="button"
              variant="danger"
              className="ml-auto"
              disabled={remove.isPending}
              onClick={() => window.confirm(`Delete @${tag.name}? Posts that used it keep the words; nobody is told from now on.`) && remove.mutate({ id: tag.id })}
            >
              Delete
            </Button>
          )}
        </div>
      </form>
    </Popup>
  );
}

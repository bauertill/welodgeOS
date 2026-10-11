"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "~/trpc/react";

type Person = { id: string; name: string | null; email: string | null };

/**
 * Who completes a task, changed in one click (doc §2.8): opens a list of the
 * team, ticked for those on it — click a name to put them on or take them
 * off. Saved at once; whoever is newly put on is told (§2.9).
 */
export function AssigneePicker({ taskId, assignees, children }: { taskId: string; assignees: Person[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLSpanElement>(null);
  const utils = api.useUtils();
  const people = api.user.list.useQuery(undefined, { enabled: open });
  const update = api.task.update.useMutation({
    onSettled: () => {
      void utils.task.invalidate();
      void utils.audit.invalidate();
    },
  });
  // Shown at once, while saving.
  const [ids, setIds] = useState(assignees.map((person) => person.id));
  useEffect(() => setIds(assignees.map((person) => person.id)), [assignees]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((one) => one !== id) : [...ids, id];
    setIds(next);
    update.mutate({ id: taskId, assigneeIds: next });
  };
  const wanted = search.trim().toLowerCase();
  const shown = (people.data ?? []).filter((person) => !wanted || `${person.name ?? ""} ${person.email ?? ""}`.toLowerCase().includes(wanted));

  return (
    <span ref={ref} className="relative inline-block" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change who completes it"
        className="hover:bg-ink-50 -m-1 rounded-full p-1 text-left"
      >
        {children}
      </button>
      {open && (
        <span className="border-ink-200/70 absolute top-full right-0 z-30 mt-1 block w-60 rounded-xl border bg-white p-2 text-left shadow-lg">
          <span className="text-ink-500 block px-2 pb-1.5 text-[11px] font-medium tracking-wider uppercase">Who completes it</span>
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search the team"
            className="border-ink-200 mb-1 w-full rounded-lg border px-2.5 py-1.5 text-[13px] font-light outline-none"
          />
          <span role="listbox" aria-multiselectable className="block max-h-64 overflow-y-auto">
            {!people.data && <span className="text-ink-500 block px-2 py-1.5 text-xs">Loading…</span>}
            {shown.map((person) => {
              const on = ids.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(person.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${on ? "bg-brand-50 text-brand-800" : "text-ink-700 hover:bg-ink-50"}`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? "border-brand-500 bg-brand-500 text-white" : "border-ink-300"}`}>{on ? "✓" : ""}</span>
                  <span className="truncate">{person.name ?? person.email}</span>
                </button>
              );
            })}
          </span>
          {update.error && <span className="block px-2 pt-1 text-xs text-[#c03654]">That did not save — try again.</span>}
        </span>
      )}
    </span>
  );
}

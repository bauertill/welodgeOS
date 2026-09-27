"use client";

import type { GroupColour, PropertyType, ScoutingStatus } from "generated/prisma";
import { useState } from "react";

import { Button, FormError, Input } from "~/app/_components/form";
import {
  groupColourOrder,
  groupColours,
  propertyTypeColours,
  propertyTypeLabels,
  scoutingStatusColours,
  scoutingStatusLabels,
} from "~/lib/scouting";
import { api } from "~/trpc/react";

type Group = { id: string; eventId: string; name: string; colour: GroupColour };
type Person = { id: string; name: string | null; email: string | null };
type Entry = {
  status: ScoutingStatus;
  property: { type: PropertyType; categories: unknown[] };
  accountManager: Person | null;
};

/** A colleague as two initials in a circle, named on hover. */
export function Initials({ person }: { person: Person }) {
  const name = person.name ?? person.email ?? "?";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      title={name}
      className="bg-brand-50 text-brand-700 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ring-2 ring-white"
    >
      {initials}
    </span>
  );
}

/**
 * A group's header on the Properties tab (doc §3.9): its name in its colour,
 * how many properties and room categories it holds, and the mix of statuses
 * and property types as two thin bars. "No group" gets the same header, with
 * nothing to edit.
 */
export function GroupHeader({
  group,
  entries,
  collapsed,
  onToggle,
  isFirst,
  isLast,
}: {
  group: Group | null;
  entries: Entry[];
  collapsed: boolean;
  onToggle: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const colour = group ? groupColours[group.colour].hex : "#6b7280";
  const [editing, setEditing] = useState(false);
  const categories = entries.reduce((sum, entry) => sum + entry.property.categories.length, 0);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 items-center gap-2 text-left"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
          style={{ color: colour }}
        >
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="truncate text-[17px] font-semibold" style={{ color: colour }}>
          {group?.name ?? "No group"}
        </span>
      </button>
      <span className="text-ink-500 text-[13px] font-light">
        {entries.length} {entries.length === 1 ? "property" : "properties"} / {categories}{" "}
        {categories === 1 ? "room category" : "room categories"}
      </span>

      {managers(entries).length > 0 && (
        <span className="flex -space-x-2" aria-label="Account managers">
          {managers(entries).map((person) => (
            <Initials key={person.id} person={person} />
          ))}
        </span>
      )}

      {entries.length > 0 && (
        <div className="flex items-center gap-3">
          <MixBar
            label="Status"
            parts={tally(entries.map((entry) => entry.status)).map(([status, count]) => ({
              key: status,
              label: scoutingStatusLabels[status as keyof typeof scoutingStatusLabels] ?? "Contracted",
              colour: scoutingStatusColours[status as keyof typeof scoutingStatusColours],
              count,
            }))}
          />
          <MixBar
            label="Type"
            parts={tally(entries.map((entry) => entry.property.type)).map(([type, count]) => ({
              key: type,
              label: propertyTypeLabels[type as PropertyType],
              colour: propertyTypeColours[type as PropertyType],
              count,
            }))}
          />
        </div>
      )}

      {group && (
        <GroupMenu
          group={group}
          isFirst={isFirst}
          isLast={isLast}
          editing={editing}
          setEditing={setEditing}
        />
      )}
    </div>
  );
}

/** The group's account managers, each once. */
function managers(entries: Entry[]) {
  const seen = new Map<string, Person>();
  for (const entry of entries) if (entry.accountManager) seen.set(entry.accountManager.id, entry.accountManager);
  return [...seen.values()];
}

function tally(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** A thin bar split by share, with the numbers on hover. */
function MixBar({
  label,
  parts,
}: {
  label: string;
  parts: { key: string; label: string; colour: string; count: number }[];
}) {
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  const summary = parts.map((part) => `${part.count} ${part.label.toLowerCase()}`).join(", ");
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${summary}`}>
      <span className="text-ink-500 text-[11px] font-light">{label}</span>
      <span className="flex h-2.5 w-24 overflow-hidden rounded-full" role="img" aria-label={`${label}: ${summary}`}>
        {parts.map((part) => (
          <span key={part.key} style={{ width: `${(part.count / total) * 100}%`, background: part.colour }} />
        ))}
      </span>
    </span>
  );
}

function useGroupRefresh() {
  const utils = api.useUtils();
  return () => {
    void utils.scouting.groups.invalidate();
    void utils.scouting.listForEvent.invalidate();
  };
}

/** Rename, recolour, move up or down, delete. */
function GroupMenu({
  group,
  isFirst,
  isLast,
  editing,
  setEditing,
}: {
  group: Group;
  isFirst: boolean;
  isLast: boolean;
  editing: boolean;
  setEditing: (value: boolean) => void;
}) {
  const refresh = useGroupRefresh();
  const update = api.scouting.updateGroup.useMutation({ onSuccess: refresh });
  const move = api.scouting.moveGroup.useMutation({ onSuccess: refresh });
  const remove = api.scouting.deleteGroup.useMutation({ onSuccess: refresh });
  const [name, setName] = useState(group.name);

  if (editing) {
    return (
      <form
        className="flex w-full flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ id: group.id, name }, { onSuccess: () => setEditing(false) });
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-72" aria-label="Group name" autoFocus />
        <ColourPicker value={group.colour} onChange={(colour) => update.mutate({ id: group.id, colour })} />
        <Button type="submit" className="px-4 py-1.5" disabled={!name.trim() || update.isPending}>
          Save
        </Button>
        <Button type="button" variant="ghost" className="px-2 py-1.5" onClick={() => setEditing(false)}>
          Done
        </Button>
        <FormError message={update.error?.message} />
      </form>
    );
  }

  return (
    <span className="text-ink-500 ml-auto flex items-center gap-1 text-[12px] font-light">
      <button type="button" className="hover:text-brand-700 px-1.5" onClick={() => setEditing(true)}>
        Rename / colour
      </button>
      <button
        type="button"
        className="hover:text-brand-700 px-1.5 disabled:opacity-30"
        disabled={isFirst || move.isPending}
        onClick={() => move.mutate({ id: group.id, direction: "up" })}
        aria-label="Move group up"
      >
        ↑
      </button>
      <button
        type="button"
        className="hover:text-brand-700 px-1.5 disabled:opacity-30"
        disabled={isLast || move.isPending}
        onClick={() => move.mutate({ id: group.id, direction: "down" })}
        aria-label="Move group down"
      >
        ↓
      </button>
      <button
        type="button"
        className="px-1.5 hover:text-[#c03654]"
        disabled={remove.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Delete the group "${group.name}"? Its properties stay on this event's list, under "No group".`,
            )
          ) {
            remove.mutate({ id: group.id });
          }
        }}
      >
        Delete
      </button>
    </span>
  );
}

function ColourPicker({ value, onChange }: { value: GroupColour; onChange: (colour: GroupColour) => void }) {
  return (
    <span className="flex items-center gap-1" role="radiogroup" aria-label="Group colour">
      {groupColourOrder.map((colour) => (
        <button
          key={colour}
          type="button"
          role="radio"
          aria-checked={value === colour}
          aria-label={groupColours[colour].label}
          title={groupColours[colour].label}
          onClick={() => onChange(colour)}
          className={`h-6 w-6 rounded-full transition-transform ${value === colour ? "ring-ink-900 scale-110 ring-2 ring-offset-2" : ""}`}
          style={{ background: groupColours[colour].hex }}
        />
      ))}
    </span>
  );
}

/** "+ Add new group" at the foot of the tab. */
export function NewGroup({ eventId }: { eventId: string }) {
  const refresh = useGroupRefresh();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [colour, setColour] = useState<GroupColour>("PURPLE");
  const create = api.scouting.createGroup.useMutation({
    onSuccess: () => {
      refresh();
      setOpen(false);
      setName("");
    },
  });

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        + Add new group
      </Button>
    );
  }
  return (
    <form
      className="border-ink-200/60 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ eventId, name, colour });
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Proposal received"
        aria-label="Group name"
        className="w-72"
        autoFocus
      />
      <ColourPicker value={colour} onChange={setColour} />
      <Button type="submit" disabled={!name.trim() || create.isPending}>
        Add group
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <FormError message={create.error?.message} />
    </form>
  );
}

"use client";

import { formatDay } from "~/lib/format";
import { api } from "~/trpc/react";

type Entry = {
  id: string;
  createdAt: Date;
  summary: string;
  changes: string | null;
  actor: { name: string | null; email: string | null } | null;
};

function EntryList({ entries }: { entries: Entry[] | undefined }) {
  if (!entries) return null;
  if (entries.length === 0) {
    return <p className="text-ink-500 text-sm font-light">No activity yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ink-900 font-medium">{entry.summary}</span>
            <span className="text-ink-500 text-xs font-light whitespace-nowrap">
              {formatDay(entry.createdAt)} · {entry.actor?.name ?? entry.actor?.email ?? "—"}
            </span>
          </div>
          {entry.changes && (
            <p className="text-ink-500 mt-0.5 whitespace-pre-line text-xs font-light">
              {entry.changes}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The general audit trail (doc §4.9), read-only — a status flip, an edit,
 * a removal, for anything that isn't a room-night (that's the Inventory
 * tab's ledger). Every write site is a mutation elsewhere; this only reads.
 */
export function ActivityLog({ entity, entityId }: { entity: string; entityId: string }) {
  const activity = api.audit.list.useQuery({ entity, entityId });
  return <EntryList entries={activity.data} />;
}

/** A scouting entry's own status history plus every one of its category
 * contracts' — merged, since on the Properties tab both live in one row. */
export function ScoutingActivityLog({ scoutingEntryId }: { scoutingEntryId: string }) {
  const activity = api.audit.forScoutingEntry.useQuery({ scoutingEntryId });
  return <EntryList entries={activity.data} />;
}

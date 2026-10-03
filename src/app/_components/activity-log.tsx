"use client";

import { useState } from "react";

import { formatDay } from "~/lib/format";
import { api } from "~/trpc/react";

type Entry = {
  id: string;
  createdAt: Date;
  summary: string;
  changes: string | null;
  actor: { name: string | null; email: string | null } | null;
};

function EntryList({ entries, latestOnly = false }: { entries: Entry[] | undefined; latestOnly?: boolean }) {
  const [all, setAll] = useState(false);
  if (!entries) return null;
  if (entries.length === 0) {
    return <p className="text-ink-500 text-sm font-light">No activity yet.</p>;
  }
  const hidden = latestOnly && !all ? entries.length - 1 : 0;
  return (
    <div>
    <ul className="space-y-2">
      {entries.slice(0, entries.length - hidden).map((entry) => (
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
    {latestOnly && entries.length > 1 && (
      <button type="button" onClick={() => setAll(!all)} className="text-brand-700 mt-2 text-xs font-light hover:underline">
        {all ? "Show only the latest" : `Show all ${entries.length}`}
      </button>
    )}
    </div>
  );
}

/**
 * The general audit trail (doc §4.9), read-only — a status flip, an edit,
 * a removal, for anything that isn't a room-night (that's the Inventory
 * tab's ledger). Every write site is a mutation elsewhere; this only reads.
 */
export function ActivityLog({ entity, entityId, latestOnly }: { entity: string; entityId: string; latestOnly?: boolean }) {
  const activity = api.audit.list.useQuery({ entity, entityId });
  return <EntryList entries={activity.data} latestOnly={latestOnly} />;
}

/** A scouting entry's own status history plus every one of its category
 * contracts' — merged, since on the Properties tab both live in one row. */
export function ScoutingActivityLog({ scoutingEntryId }: { scoutingEntryId: string }) {
  const activity = api.audit.forScoutingEntry.useQuery({ scoutingEntryId });
  return <EntryList entries={activity.data} />;
}

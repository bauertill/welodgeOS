"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, FormError, friendlyError, Select } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

/**
 * Bringing monday.com's sales requests in (doc §4.11, 2026-11-09): the file
 * of deals, monday's events matched to ours, a preview of what each deal
 * becomes, then the import — each deal its own sales request.
 */

type Deals = RouterInputs["mondayImport"]["run"]["deals"];
type Row = RouterOutputs["mondayImport"]["preview"][number];

/** A first guess at which of our events a monday label is ("SOL28" → LA28, "Rydercup" → Ryder Cup). */
const hints: Record<string, string[]> = {
  sol28: ["la28", "los angeles", "olympic"],
  belgrade: ["belgrade", "expo"],
  rydercup: ["ryder"],
  "wfwc 27": ["women", "wfwc"],
};
function guess(label: string, events: { id: string; name: string }[]) {
  const words = hints[label.toLowerCase()] ?? [label.toLowerCase()];
  return events.find((event) => words.some((word) => event.name.toLowerCase().includes(word)))?.id ?? "";
}

export function MondayImport() {
  const events = api.mondayImport.events.useQuery();
  const [deals, setDeals] = useState<Deals | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const preview = api.mondayImport.preview.useMutation({
    onSuccess: (rows) => setTicked(new Set(rows.filter((row) => !row.alreadyImported).map((row) => row.mondayId))),
  });
  const run = api.mondayImport.run.useMutation();

  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const deal of deals ?? []) if (deal.event) counts.set(deal.event, (counts.get(deal.event) ?? 0) + 1);
    return [...counts.entries()];
  }, [deals]);
  const eventMap = Object.fromEntries(labels.map(([label]) => [label, map[label] || null]));

  const read = async (file: File) => {
    setFileProblem(null);
    preview.reset();
    run.reset();
    try {
      const parsed = JSON.parse(await file.text()) as { deals?: Deals };
      if (!Array.isArray(parsed.deals) || parsed.deals.length === 0) throw new Error("no deals");
      setDeals(parsed.deals);
      const found = events.data ?? [];
      setMap(Object.fromEntries([...new Set(parsed.deals.map((deal) => deal.event).filter((e): e is string => Boolean(e)))].map((label) => [label, guess(label, found)])));
    } catch {
      setDeals(null);
      setFileProblem("That file is not a monday export this page can read — choose the .json file of deals.");
    }
  };

  if (run.data) {
    return (
      <Card>
        <p className="text-[15px] font-medium text-[#0a7a47]">
          ✓ {run.data.imported} sales {run.data.imported === 1 ? "request" : "requests"} imported
          {run.data.skipped ? ` · ${run.data.skipped} already imported, skipped` : ""}.
        </p>
        <p className="text-ink-500 mt-1 text-sm font-light">Each is at Initial interest, with its monday notes in its fields and its contacts on the client. The history of each says it came from monday.com.</p>
        <Link href="/sales" className="text-brand-700 mt-3 inline-block text-[13px] font-medium hover:underline">
          See the sales requests →
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-ink-900 mb-1 text-[15px] font-medium">1. The file of deals</h2>
        <p className="text-ink-500 mb-3 text-xs font-light">The .json file prepared from monday&rsquo;s Sales Requests board.</p>
        <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} className="text-ink-700 block text-sm" />
        {fileProblem && <FormError message={fileProblem} />}
        {deals && <p className="text-ink-700 mt-2 text-sm">{deals.length} deals in the file.</p>}
      </Card>

      {deals && (
        <Card>
          <h2 className="text-ink-900 mb-1 text-[15px] font-medium">2. monday&rsquo;s events, matched to ours</h2>
          <p className="text-ink-500 mb-3 text-xs font-light">Create any missing event first (Events), then come back. A deal whose event is left as none comes in with no event.</p>
          <div className="space-y-2">
            {labels.map(([label, count]) => (
              <div key={label} className="grid grid-cols-[10rem_1fr] items-center gap-3 text-sm">
                <span>
                  <span className="font-medium">{label}</span> <span className="text-ink-500 font-light">· {count} deals</span>
                </span>
                <Select value={map[label] ?? ""} onChange={(e) => setMap((current) => ({ ...current, [label]: e.target.value }))} aria-label={`Our event for ${label}`}>
                  <option value="">No event</option>
                  {(events.data ?? []).map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Button type="button" onClick={() => preview.mutate({ deals, events: eventMap })} disabled={preview.isPending}>
              {preview.isPending ? "Checking…" : preview.data ? "Check again" : "3. See what each deal becomes"}
            </Button>
            {preview.error && <FormError message={friendlyError(preview.error)} />}
          </div>
        </Card>
      )}

      {deals && preview.data && <PreviewTable rows={preview.data} ticked={ticked} setTicked={setTicked} />}

      {deals && preview.data && (
        <div className="space-y-2">
          <Button type="button" onClick={() => run.mutate({ deals, events: eventMap, only: [...ticked] })} disabled={run.isPending || ticked.size === 0}>
            {run.isPending ? "Importing…" : `Import ${ticked.size} ${ticked.size === 1 ? "deal" : "deals"}`}
          </Button>
          {run.error && <FormError message={friendlyError(run.error)} />}
        </div>
      )}
    </div>
  );
}

function PreviewTable({ rows, ticked, setTicked }: { rows: Row[]; ticked: Set<string>; setTicked: (next: Set<string>) => void }) {
  const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider uppercase text-left";
  const td = "border-ink-200/40 border-b px-3 py-2 align-top text-[13px] font-light";
  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  };
  const newClients = new Set(rows.filter((row) => row.client.isNew && ticked.has(row.mondayId)).map((row) => row.client.name.toLowerCase())).size;
  return (
    <Card>
      <h2 className="text-ink-900 mb-1 text-[15px] font-medium">What each deal becomes</h2>
      <p className="text-ink-500 mb-3 text-xs font-light">
        {ticked.size} ticked · {newClients} new {newClients === 1 ? "client" : "clients"}. Untick any deal you do not want; nothing is written until you import.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>
                <span className="sr-only">Import</span>
              </th>
              <th className={th}>Deal / client</th>
              <th className={th}>Event</th>
              <th className={th}>Account manager</th>
              <th className={th}>Contacts</th>
              <th className={th}>Look at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.mondayId} className={row.alreadyImported ? "opacity-60" : ""}>
                <td className={td}>
                  <input type="checkbox" checked={ticked.has(row.mondayId)} disabled={Boolean(row.alreadyImported)} onChange={() => toggle(row.mondayId)} aria-label={`Import ${row.name}`} />
                </td>
                <td className={td}>
                  <span className="text-ink-900 font-medium">{row.client.name}</span>
                  <span className={`block text-xs ${row.client.isNew ? "text-brand-700" : "text-ink-500"}`}>{row.client.isNew ? "New client" : "Existing client"}</span>
                </td>
                <td className={td}>{row.event?.name ?? <span className="text-ink-500">None{row.mondayEvent ? ` (monday: ${row.mondayEvent})` : ""}</span>}</td>
                <td className={td}>{row.owner?.name ?? <span className="text-ink-500">—</span>}</td>
                <td className={td}>
                  {row.contacts.length === 0
                    ? "—"
                    : row.contacts.map((contact) => (
                        <span key={contact.mondayId} className="block">
                          {contact.name}
                          <span className="text-ink-500 text-xs">{contact.existingId ? " · on the client" : " · new"}</span>
                        </span>
                      ))}
                </td>
                <td className={`${td} text-[#8a5a00]`}>
                  {row.alreadyImported ? (
                    <Link href={`/sales/${row.alreadyImported}`} className="text-brand-700 hover:underline">
                      Already imported →
                    </Link>
                  ) : (
                    row.notes.map((note) => (
                      <span key={note} className="block text-xs">
                        {note}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

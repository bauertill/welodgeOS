"use client";

import { useState } from "react";

import { BringIntoInventory } from "~/app/_components/bring-into-inventory";
import { BulkAction } from "~/app/_components/bulk-action";
import { Select } from "~/app/_components/form";
import {
  Card,
  EmptyState,
  SectionHeading,
  SeverityBadge,
  StatCard,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatDay, formatMoney, formatRange } from "~/lib/format";
import { acquisitionLabels, salesLabels } from "~/lib/inventory";
import { severityLabels, type Severity } from "~/lib/position";
import type { StayRow } from "~/lib/stay-rows";
import { api } from "~/trpc/react";

/**
 * The stock sheet (doc §5.4) and the two ways it is changed: bringing rooms
 * into inventory (§3.6) and applying a bulk transition to them (§4.8).
 *
 * The rows are **derived, never stored**. Adjacent nights on the same room
 * collapse into one row for as long as nothing about them changes — which is
 * why a client dropping three nights is an edit here rather than the row split
 * that makes the spreadsheet fragile.
 */
export function InventoryBoard({
  eventId,
  defaultCheckIn,
  defaultCheckOut,
}: {
  eventId: string;
  defaultCheckIn: string;
  defaultCheckOut: string;
}) {
  const utils = api.useUtils();
  const [propertyId, setPropertyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [minSeverity, setMinSeverity] = useState("");

  const structure = api.inventory.structure.useQuery({ eventId });
  const clients = api.clients.list.useQuery();
  const summary = api.reporting.summary.useQuery({ eventId });
  const rows = api.inventory.stockSheet.useQuery({
    eventId,
    propertyId: propertyId || undefined,
    clientId: clientId || undefined,
    minSeverity: minSeverity ? Number(minSeverity) : undefined,
  });
  const ledger = api.inventory.ledger.useQuery({ eventId, limit: 25 });

  const refresh = () => {
    void utils.inventory.invalidate();
    void utils.reporting.invalidate();
  };

  const properties = structure.data ?? [];
  const stats = summary.data;

  return (
    <div className="space-y-8">
      {stats && stats.roomNights > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Room-nights"
            value={stats.roomNights}
            hint={`${stats.rooms} rooms in this event`}
          />
          <StatCard
            label="Bought"
            value={stats.bought}
            hint={`${stats.onOption} more on option`}
          />
          <StatCard
            label="Sold"
            value={stats.sold}
            hint={`${stats.blocked} blocked · ${stats.contested} room-nights another client is also asking for`}
          />
          <StatCard
            label="Short"
            value={stats.short}
            hint={`Sold or blocked but not bought · ${stats.long} bought and unsold`}
          />
        </div>
      )}

      <BringIntoInventory
        eventId={eventId}
        defaultCheckIn={defaultCheckIn}
        defaultCheckOut={defaultCheckOut}
        onDone={refresh}
      />

      {properties.length > 0 && (
        <BulkAction
          eventId={eventId}
          structure={properties}
          defaultCheckIn={defaultCheckIn}
          defaultCheckOut={defaultCheckOut}
          onApplied={refresh}
        />
      )}

      <div>
        <SectionHeading
          title="Stock sheet"
          hint="One row per run of nights that share the same story. Editing a row means changing the nights underneath it."
        />

        <SeverityCounts
          counts={rows.data?.severityCounts}
          minSeverity={minSeverity}
          onPick={setMinSeverity}
        />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="w-auto"
          >
            <option value="">Every property</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </Select>

          <Select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-auto"
          >
            <option value="">Every client</option>
            {(clients.data ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>

          <Select
            value={minSeverity}
            onChange={(e) => setMinSeverity(e.target.value)}
            className="w-auto"
          >
            <option value="">Everything</option>
            <option value="1">Needs a look or worse</option>
            <option value="2">Warnings and worse</option>
            <option value="3">Urgent and critical only</option>
            <option value="4">Critical only</option>
          </Select>

          <span className="text-ink-500 ml-auto text-[13px] font-light">
            {rows.isLoading
              ? "Loading…"
              : `${rows.data?.rows.length ?? 0} ${rows.data?.rows.length === 1 ? "row" : "rows"}`}
          </span>
        </div>

        {rows.data && rows.data.rows.length === 0 && !rows.isLoading ? (
          <EmptyState
            title="Nothing here yet"
            description="Bring rooms into inventory above, then record what happens with the supplier and the client."
          />
        ) : (
          <StockSheet rows={rows.data?.rows ?? []} />
        )}
      </div>

      <div>
        <SectionHeading
          title="What changed"
          hint="Every change is kept for good: who did it, to how many nights, and why."
        />
        {ledger.data && ledger.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
                <Th>From</Th>
                <Th>Nights</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.data.map((entry) => (
                <tr key={entry.id}>
                  <Td>
                    <span className="whitespace-nowrap">
                      {formatDay(entry.createdAt)}
                    </span>
                  </Td>
                  <Td>{entry.actor?.name ?? entry.actor?.email ?? "—"}</Td>
                  <Td>
                    {entry.summary}
                    {entry.reason && (
                      <span className="text-ink-500 block text-xs font-light">
                        {entry.reason}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-ink-500 text-xs font-light">
                      {entry.fromState ?? "—"}
                    </span>
                  </Td>
                  <Td>{entry.nightCount}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Card>
            <p className="text-ink-500 text-sm font-light">
              Nothing has changed yet.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Matches the dropdown's own tiers, so a chip and its filter option agree. */
const severityChipLabels: Record<number, string> = {
  1: "need a look",
  2: "warnings",
  3: "urgent",
  4: "critical",
};

/**
 * What to look out for, before anyone scrolls the stock sheet — otherwise the
 * only way to know whether a 60-row sheet is quiet or on fire is to read it
 * end to end.
 */
function SeverityCounts({
  counts,
  minSeverity,
  onPick,
}: {
  counts?: Record<number, number>;
  minSeverity: string;
  onPick: (value: string) => void;
}) {
  if (!counts) return null;

  const issues = ([4, 3, 2, 1] as const).filter((sev) => counts[sev]! > 0);

  if (issues.length === 0) {
    return (
      <p className="text-ink-500 mb-4 text-[13px] font-light">
        Nothing to look out for — every row is clear.
      </p>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-ink-500 text-[13px] font-light">Look out for:</span>
      {issues.map((sev) => {
        const active = minSeverity === String(sev);
        return (
          <button
            key={sev}
            type="button"
            onClick={() => onPick(active ? "" : String(sev))}
            className={active ? "ring-brand-400 rounded-full ring-2" : ""}
          >
            <SeverityBadge severity={sev}>
              {counts[sev]} {severityChipLabels[sev]}
            </SeverityBadge>
          </button>
        );
      })}
    </div>
  );
}

/** Rows grouped property → category → room number, matching today's layout. */
function StockSheet({ rows }: { rows: StayRow[] }) {
  const groups = new Map<string, StayRow[]>();
  for (const row of rows) {
    const key = `${row.propertyName}|${row.categoryName}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([key, group]) => (
        <div key={key}>
          <h3 className="text-ink-700 mb-2 text-[13px] font-medium">
            {group[0]!.propertyName}{" "}
            <span className="text-ink-500 font-light">
              · {group[0]!.categoryName}
            </span>
          </h3>
          <Table>
            <thead>
              <tr>
                <Th>Room</Th>
                <Th>Stay</Th>
                <Th>Supplier</Th>
                <Th>Client</Th>
                <Th>Where that leaves us</Th>
                <Th>Money</Th>
              </tr>
            </thead>
            <tbody>
              {group.map((row) => (
                <tr key={row.key}>
                  <Td>
                    <span className="font-medium">#{row.slotNumber}</span>
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap">
                      {formatRange(row.checkIn, row.checkOut)}
                    </span>
                    <span className="text-ink-500 block text-xs font-light">
                      {row.nights} {row.nights === 1 ? "night" : "nights"}
                    </span>
                  </Td>
                  <Td>
                    {acquisitionLabels[row.acquisitionState]}
                    <span className="text-ink-500 block text-xs font-light">
                      {[
                        row.supplierRef,
                        row.optionExpiry
                          ? `to ${formatDay(row.optionExpiry)}`
                          : null,
                        row.acquisitionOwner,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </Td>
                  <Td>
                    {row.position.sales === "REQUESTED"
                      ? `Requested by ${row.requestedBy.map((r) => r.name).join(", ")}`
                      : `${salesLabels[row.salesState]}${row.clientName ? ` · ${row.clientName}` : ""}`}
                    <span className="text-ink-500 block text-xs font-light">
                      {[
                        row.clientRef,
                        row.blockExpiry
                          ? `to ${formatDay(row.blockExpiry)}`
                          : null,
                        row.dueDate ? `due ${formatDay(row.dueDate)}` : null,
                        row.salesOwner,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                    {/* A hard hold hides the soft requests underneath it, and
                        those requests are exactly what says "sell this again
                        the moment it frees up" (doc §4.3). */}
                    {row.position.sales !== "REQUESTED" &&
                      row.requestedBy.length > 0 && (
                        <span className="text-brand-700 mt-1 block text-xs">
                          Also wanted by{" "}
                          {row.requestedBy.map((r) => r.name).join(", ")}
                        </span>
                      )}
                  </Td>
                  <Td>
                    <div className="flex max-w-80 items-start gap-2">
                      <span aria-hidden>{row.position.icon}</span>
                      <div>
                        <span className="block">{row.position.headline}</span>
                        {row.position.detail && (
                          <span className="text-ink-500 block text-xs font-light">
                            {row.position.detail}
                          </span>
                        )}
                        {row.position.flags.map((flag) => (
                          <span
                            key={flag}
                            className="mt-1 block text-xs font-medium text-[#c03654]"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <SeverityBadge severity={row.position.severity as Severity}>
                        {severityLabels[row.position.severity as Severity]}
                      </SeverityBadge>
                      <span className="text-ink-500 text-xs font-light">
                        {row.buyPriceCents !== null && row.buyCurrency
                          ? `Buy ${formatMoney(row.buyPriceCents, row.buyCurrency)}`
                          : "Buy —"}
                        {" · "}
                        {row.sellPriceCents !== null && row.sellCurrency
                          ? `Sell ${formatMoney(row.sellPriceCents, row.sellCurrency)}`
                          : "Sell —"}
                      </span>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}
    </div>
  );
}

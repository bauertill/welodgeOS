"use client";

import { BringIntoInventory } from "~/app/_components/bring-into-inventory";
import { InventoryGrid } from "~/app/_components/inventory-grid";
import { Card, SectionHeading, StatCard, Table, Td, Th } from "~/app/_components/ui";
import { formatDay } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * Phase 2 (doc §4): what we hold and what we have promised, changed two
 * ways — bringing rooms into inventory (§3.6) and editing them on the grid
 * (§4.8), which applies every bulk transition to a *rectangle* of rooms ×
 * nights, atomically.
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
  const summary = api.reporting.summary.useQuery({ eventId });
  const ledger = api.inventory.ledger.useQuery({ eventId, limit: 25 });

  const refresh = () => {
    void utils.inventory.invalidate();
    void utils.reporting.invalidate();
  };

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

      <InventoryGrid
        eventId={eventId}
        defaultCheckIn={defaultCheckIn}
        defaultCheckOut={defaultCheckOut}
        onChanged={refresh}
      />

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

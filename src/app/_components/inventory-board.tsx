"use client";

import { useState } from "react";

import { Button } from "~/app/_components/form";
import { InventoryGrid } from "~/app/_components/inventory-grid";
import { Card, SectionHeading, Table, Td, Th } from "~/app/_components/ui";
import { formatDay } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * Phase 2 (doc §4): what we hold and what we have promised, changed on the
 * stock sheet (§4.8), which applies every bulk transition to a *rectangle* of
 * rooms × nights, atomically. Every room of the properties on the event's
 * list is on it from the start (§3.6) — there is no step that brings rooms
 * in. The headline numbers are on the Position tab.
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
  const ledger = api.inventory.ledger.useQuery({ eventId, limit: 25 });
  const [undoError, setUndoError] = useState<string | null>(null);

  const refresh = () => {
    void utils.inventory.invalidate();
    void utils.reporting.invalidate();
  };

  const undo = api.inventory.undo.useMutation({
    onSuccess: () => {
      setUndoError(null);
      refresh();
    },
    onError: (error) => setUndoError(error.message),
  });

  return (
    <div className="space-y-8">
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
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>What</Th>
                  <Th>From</Th>
                  <Th>Nights</Th>
                  <Th>{""}</Th>
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
                      {entry.details && (
                        // What the change did to prices, references, notes and dates (doc §4.7).
                        <span className="text-ink-700 mt-1 block text-xs font-light whitespace-pre-line">
                          {entry.details}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-ink-500 text-xs font-light">
                        {entry.fromState ?? "—"}
                      </span>
                    </Td>
                    <Td>{entry.nightCount}</Td>
                    <Td>
                      {entry.undone && (
                        <span className="text-ink-500 text-xs font-light">Undone</span>
                      )}
                      {entry.undoable && (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={undo.isPending}
                          onClick={() => {
                            setUndoError(null);
                            undo.mutate({ ledgerEntryId: entry.id });
                          }}
                        >
                          Undo
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {undoError && (
              <p className="mt-2 text-[13px] whitespace-pre-line text-[#c03654]">
                {undoError}
              </p>
            )}
          </>
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

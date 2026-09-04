"use client";

import {
  Card,
  EmptyState,
  MoneyTotal,
  SectionHeading,
  SeverityBadge,
  StatCard,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatDate, formatRooms } from "~/lib/format";
import {
  REMINDER_WINDOW_DAYS,
  URGENCY_WINDOW_DAYS,
  type Severity,
} from "~/lib/position";
import { api } from "~/trpc/react";

/**
 * §4.6 — the deadline dashboard. Everything expiring, soonest first, grouped by
 * property and client, with the value at stake.
 *
 * Nothing on this screen changes state on its own. An expired option or block
 * is **flagged, never released** (doc §2.4): the system does not know what the
 * supplier believes, so a human decides to extend, convert or let it go.
 */
const kindLabels = {
  option: "Our option with the supplier",
  block: "The client's block",
  due: "The client's due date",
} as const;

const urgencyCopy = {
  expired: "Already gone by",
  urgent: "Now",
  upcoming: "Soon",
  none: "Later",
} as const;

export function DeadlineDashboard({ eventId }: { eventId: string }) {
  const deadlines = api.reporting.deadlines.useQuery({ eventId });
  const rows = deadlines.data ?? [];

  const expired = rows.filter((row) => row.urgency === "expired");
  const urgent = rows.filter((row) => row.urgency === "urgent");
  const upcoming = rows.filter((row) => row.urgency === "upcoming");

  if (deadlines.isLoading) {
    return (
      <Card>
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing runs out soon"
        description={`No option, block or due date on this event falls inside the next ${REMINDER_WINDOW_DAYS} days.`}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Already gone by"
          value={expired.length}
          hint="Nothing was released automatically — someone has to decide"
        />
        <StatCard
          label="Within 48 hours"
          value={urgent.length}
          hint={`Inside the ${URGENCY_WINDOW_DAYS}-day urgency window`}
        />
        <StatCard
          label="This week"
          value={upcoming.length}
          hint={`Inside the ${REMINDER_WINDOW_DAYS}-day reminder window`}
        />
      </div>

      <div>
        <SectionHeading
          title="What runs out"
          hint="Soonest first. An expiry that has passed stays here until somebody extends it, converts it or lets it go."
        />
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>What</Th>
              <Th>Where</Th>
              <Th>Client</Th>
              <Th>Size</Th>
              <Th>At stake</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <Td>
                  <span className="whitespace-nowrap font-medium">
                    {formatDate(row.date)}
                  </span>
                  <span className="text-ink-500 block text-xs font-light">
                    {urgencyCopy[row.urgency]}
                    {row.daysAway === 0
                      ? " · today"
                      : row.daysAway > 0
                        ? ` · in ${row.daysAway} ${row.daysAway === 1 ? "day" : "days"}`
                        : ` · ${-row.daysAway} ${row.daysAway === -1 ? "day" : "days"} ago`}
                  </span>
                </Td>
                <Td>
                  {kindLabels[row.kind]}
                  <span className="text-ink-500 block max-w-72 text-xs font-light">
                    {row.headline}
                  </span>
                </Td>
                <Td>
                  {row.propertyName}
                  <span className="text-ink-500 block text-xs font-light">
                    {row.categoryName}
                  </span>
                </Td>
                <Td>{row.clientName ?? "—"}</Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatRooms(row.rooms)}
                  </span>
                  <span className="text-ink-500 block text-xs font-light">
                    {row.nights} room-nights
                  </span>
                </Td>
                <Td>
                  <MoneyTotal amounts={row.value} empty="Not priced" />
                </Td>
                <Td>
                  <SeverityBadge severity={row.severity as Severity} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <Card>
        <p className="text-ink-900 font-medium">
          Why nothing here happens by itself
        </p>
        <p className="text-ink-500 mt-1 text-sm font-light">
          An option or block that has run out is flagged, never released. We do
          not know what the supplier or the client believes, so the system keeps
          it in front of you until a person extends it, converts it or lets it
          go.
        </p>
      </Card>
    </div>
  );
}

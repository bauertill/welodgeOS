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
import { LOOKAHEAD_DAYS, REMINDER_WINDOW_DAYS, severityHints, type Severity } from "~/lib/position";
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
  option: "Our option deadline",
  block: "The client's deadline",
  due: "Payment due (recorded earlier)",
} as const;

const windowCopy = {
  passed: "Already passed",
  week: "This week",
  month: "This month",
} as const;

export function DeadlineDashboard({ eventId }: { eventId: string }) {
  const deadlines = api.reporting.deadlines.useQuery({ eventId });
  const rows = deadlines.data ?? [];

  const passed = rows.filter((row) => row.window === "passed");
  const week = rows.filter((row) => row.window === "week");
  const month = rows.filter((row) => row.window === "month");

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
        title="No deadlines this month"
        description={`No option deadline or client deadline on this event falls inside the next ${LOOKAHEAD_DAYS} days, and none has passed.`}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Already passed"
          value={passed.length}
          hint="Nothing was released automatically — someone has to decide"
        />
        <StatCard label="This week" value={week.length} hint={`In the next ${REMINDER_WINDOW_DAYS} days`} />
        <StatCard label="This month" value={month.length} hint={`In the next ${LOOKAHEAD_DAYS} days, after this week`} />
      </div>

      <div>
        <SectionHeading
          title="Deadlines"
          hint="Soonest first. A deadline that has passed stays here until somebody extends it, converts it or lets it go."
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
                    {windowCopy[row.window]}
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
        <p className="text-ink-900 font-medium">What the levels mean</p>
        <dl className="mt-2 space-y-1.5 text-sm font-light">
          {([1, 2, 3, 4] as const).map((level) => (
            <div key={level} className="flex items-start gap-3">
              <dt className="w-20 shrink-0">
                <SeverityBadge severity={level} />
              </dt>
              <dd className="text-ink-700">{severityHints[level].replace(/^[A-Za-z]+ — /, "")}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <p className="text-ink-900 font-medium">
          Why nothing here happens by itself
        </p>
        <p className="text-ink-500 mt-1 text-sm font-light">
          An option deadline or a client's deadline that has passed is flagged, never released. We do
          not know what the supplier or the client believes, so the system keeps
          it in front of you until a person extends it, converts it or lets it
          go.
        </p>
      </Card>
    </div>
  );
}

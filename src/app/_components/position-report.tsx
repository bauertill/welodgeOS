"use client";

import { useState } from "react";

import { Select } from "~/app/_components/form";
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
import { formatDate, formatRange } from "~/lib/format";
import type { Severity } from "~/lib/position";
import { api } from "~/trpc/react";

/**
 * §5.1–5.3 and §7 — what we hold, what we promised, where we are exposed, and
 * what it is worth.
 *
 * Everything here is derived on read from the room-nights. Nothing is stored,
 * so a figure on this page can never disagree with the stock sheet it came
 * from. No currency is ever converted: a total that spans two currencies says
 * both (invariant §4.5.9).
 */
export function PositionReport({ eventId }: { eventId: string }) {
  const [propertyId, setPropertyId] = useState("");
  const scope = { eventId, propertyId: propertyId || undefined };

  const structure = api.inventory.structure.useQuery({ eventId });
  const summary = api.reporting.summary.useQuery(scope);
  const exposure = api.reporting.exposure.useQuery(scope);
  const availability = api.reporting.availability.useQuery(scope);
  const money = api.reporting.financials.useQuery(scope);
  const position = api.reporting.position.useQuery(scope);

  const properties = structure.data ?? [];
  const stats = summary.data;

  if (summary.isLoading) {
    return (
      <Card>
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      </Card>
    );
  }

  if (!stats || stats.roomNights === 0) {
    return (
      <EmptyState
        title="No inventory yet"
        description="Bring rooms into inventory on the Inventory tab and this page will show where they leave us."
      />
    );
  }

  return (
    <div className="space-y-8">
      {properties.length > 1 && (
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
      )}

      {/* --- §5.2 exposure -------------------------------------------------- */}
      <div>
        <SectionHeading
          title="Exposure"
          hint="Every night where what we promised the client is stronger than what we secured from the supplier — and the other way round."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
              Short — promised, not bought
            </p>
            <p className="text-ink-900 mt-2 text-3xl font-semibold">
              {(exposure.data?.short.soldNights ?? 0) +
                (exposure.data?.short.blockedNights ?? 0)}
            </p>
            <p className="text-ink-500 mt-1 text-xs font-light">
              {exposure.data?.short.soldNights ?? 0} sold and{" "}
              {exposure.data?.short.blockedNights ?? 0} blocked room-nights we do
              not own. Selling before buying is allowed — it is the business —
              but it is never invisible.
            </p>
            <dl className="mt-4 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500 font-light">Cost we have not secured</dt>
                <dd>
                  <MoneyTotal amounts={exposure.data?.short.unsecuredCost ?? []} />
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500 font-light">Revenue we could fail to deliver</dt>
                <dd>
                  <MoneyTotal amounts={exposure.data?.short.revenueAtRisk ?? []} />
                </dd>
              </div>
            </dl>
            {(exposure.data?.short.unpriced ?? 0) > 0 && (
              <p className="text-ink-500 mt-3 text-xs font-light">
                {exposure.data!.short.unpriced} of these nights cannot be valued
                — no rate has been negotiated and the category carries no
                indicative price.
              </p>
            )}
          </Card>

          <Card>
            <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
              Long — bought, nobody on it
            </p>
            <p className="text-ink-900 mt-2 text-3xl font-semibold">
              {exposure.data?.long.nights ?? 0}
            </p>
            <p className="text-ink-500 mt-1 text-xs font-light">
              Room-nights we own with no client holding them. Money sitting on
              the book.
            </p>
            <dl className="mt-4 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500 font-light">Committed cost</dt>
                <dd>
                  <MoneyTotal amounts={exposure.data?.long.committedCost ?? []} />
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
              Deadline — runs out this week
            </p>
            <p className="text-ink-900 mt-2 text-3xl font-semibold">
              {exposure.data?.deadline.nights ?? 0}
            </p>
            <p className="text-ink-500 mt-1 text-xs font-light">
              Room-nights whose option or block expires inside the reminder
              window.
            </p>
            <dl className="mt-4 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500 font-light">Value at stake</dt>
                <dd>
                  <MoneyTotal amounts={exposure.data?.deadline.value ?? []} />
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {/* --- §7 money ------------------------------------------------------- */}
      <div>
        <SectionHeading
          title="Money"
          hint="Summed over room-nights, per currency. Nothing is converted."
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MoneyCard
            label="Committed cost"
            hint="What we owe suppliers for nights we have bought"
            amounts={money.data?.committedCost ?? []}
          />
          <MoneyCard
            label="Contracted revenue"
            hint="What clients owe us for nights they have bought"
            amounts={money.data?.contractedRevenue ?? []}
          />
          <MoneyCard
            label="Realised margin"
            hint="Only on nights that are both bought and sold"
            amounts={money.data?.realisedMargin ?? []}
          />
          <MoneyCard
            label="Pipeline margin"
            hint="Not yet both bought and sold. Never added to realised margin."
            amounts={money.data?.pipelineMargin ?? []}
          />
          <MoneyCard
            label="Cost at risk"
            hint="What it will cost to buy what we have already sold"
            amounts={money.data?.costAtRisk ?? []}
          />
          <MoneyCard
            label="Idle cost"
            hint="What we are paying for nights nobody has taken"
            amounts={money.data?.idleCost ?? []}
          />
        </div>
        {(money.data?.marginNotComparable ?? 0) > 0 && (
          <p className="text-ink-500 mt-3 text-xs font-light">
            {money.data!.marginNotComparable} room-nights are bought and sold in
            different currencies, so their margin is left out rather than
            converted at a rate nobody agreed.
          </p>
        )}
      </div>

      {/* --- §5.3 availability ---------------------------------------------- */}
      <div>
        <SectionHeading
          title="What we can still offer"
          hint="Whole rooms free on every night of the window — a room free for 19 nights of 21 counts for nothing, because we sell whole stays."
        />
        <Table>
          <thead>
            <tr>
              <Th>Property</Th>
              <Th>Room type</Th>
              <Th>Window</Th>
              <Th>In inventory</Th>
              <Th>Offerable</Th>
              <Th>Genuinely free</Th>
            </tr>
          </thead>
          <tbody>
            {(availability.data ?? []).map((row) => (
              <tr key={row.categoryId}>
                <Td>{row.propertyName}</Td>
                <Td>{row.categoryName}</Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatRange(row.from, row.to)}
                  </span>
                  <span className="text-ink-500 block text-xs font-light">
                    {row.nights} nights
                  </span>
                </Td>
                <Td>{row.slots}</Td>
                <Td>
                  <span className="font-medium">{row.offerable}</span>
                  <span className="text-ink-500 block text-xs font-light">
                    Assumes blocks lapse
                  </span>
                </Td>
                <Td>
                  <span className="font-medium">{row.genuinelyFree}</span>
                  <span className="text-ink-500 block text-xs font-light">
                    Blocks counted as taken
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-ink-500 mt-2 text-xs font-light">
          Only rooms we have secured count — a night still in negotiation is not
          something we can offer. The two figures differ by exactly the blocks
          that are holding rooms without having bought them.
        </p>
      </div>

      {/* --- §5.1 position per night ---------------------------------------- */}
      <div>
        <SectionHeading
          title="Night by night"
          hint="What we hold, what we promised and who else is asking, for every night of the event."
        />
        <Table>
          <thead>
            <tr>
              <Th>Night</Th>
              <Th>Property</Th>
              <Th>Room type</Th>
              <Th>Bought</Th>
              <Th>Option</Th>
              <Th>Sold</Th>
              <Th>Blocked</Th>
              <Th>Asking</Th>
              <Th>Short</Th>
              <Th>Long</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {(position.data ?? []).map((cell) => (
              <tr key={`${cell.categoryId}-${cell.date.toISOString()}`}>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatDate(cell.date)}
                  </span>
                </Td>
                <Td>{cell.propertyName}</Td>
                <Td>{cell.categoryName}</Td>
                <Td>{cell.bought}</Td>
                <Td>{cell.option}</Td>
                <Td>{cell.soldCount}</Td>
                <Td>{cell.blocked}</Td>
                <Td>
                  {cell.requestingClients === 0 ? (
                    "—"
                  ) : (
                    <>
                      {cell.roomsRequested}
                      <span className="text-ink-500 block text-xs font-light">
                        {cell.requestingClients}{" "}
                        {cell.requestingClients === 1 ? "client" : "clients"}
                      </span>
                    </>
                  )}
                </Td>
                <Td>{cell.short || "—"}</Td>
                <Td>{cell.long || "—"}</Td>
                <Td>
                  <SeverityBadge severity={cell.severity as Severity} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-ink-500 mt-2 text-xs font-light">
          <strong className="font-medium">Short</strong> is sold but not owned.{" "}
          <strong className="font-medium">Long</strong> is owned with no client
          holding it. <strong className="font-medium">Asking</strong> counts soft
          requests, which lock nothing — several clients may want the same night,
          and that pressure is what drives the push to acquire.
        </p>
      </div>
    </div>
  );
}

function MoneyCard({
  label,
  hint,
  amounts,
}: {
  label: string;
  hint: string;
  amounts: { currency: string; cents: number }[];
}) {
  return (
    <Card>
      <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className="text-ink-900 mt-2 text-2xl font-semibold">
        <MoneyTotal amounts={amounts} empty="—" />
      </p>
      <p className="text-ink-500 mt-1 text-xs font-light">{hint}</p>
    </Card>
  );
}

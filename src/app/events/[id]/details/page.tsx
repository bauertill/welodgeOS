import { notFound, redirect } from "next/navigation";

import { HistorySection } from "~/app/_components/activity-log";
import { EventSetupPopup } from "~/app/_components/event-setup-popup";
import { EventTabs } from "~/app/_components/event-tabs";
import { Card, PageHeader } from "~/app/_components/ui";
import { dayKey, nightsBetween } from "~/lib/dates";
import { formatRange } from "~/lib/format";
import { placeCategoryLabels } from "~/lib/scouting";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

const statusLabels = { PLANNING: "Planning", ACTIVE: "Active", CLOSED: "Closed" } as const;

/**
 * The event itself (doc §2.3), the first of its tabs: what and when it is, who
 * leads it and sources it, and the places guests need to reach — each changed
 * in a popup, without leaving the tab.
 */
export default async function EventDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const event = await api.event.byId({ id });
  if (!event) notFound();

  const person = (p: { name: string | null; email: string | null }) => p.name ?? p.email ?? "—";
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3">
      <dt className="text-ink-500 w-44 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0">{value}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        back={{ href: "/events", label: "All events" }}
        title={event.name}
        subtitle={`Event details · ${formatRange(event.startDate, event.endDate)}${event.city ? ` · ${event.city}` : ""}`}
      />
      <EventTabs eventId={event.id} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-ink-900 text-[15px] font-medium">The event</h2>
            <span className="text-[13px] font-light">
              <EventSetupPopup
                part="event"
                eventId={event.id}
                eventName={event.name}
                label="Edit"
                initial={{
                  id: event.id,
                  name: event.name,
                  city: event.city ?? "",
                  country: event.country ?? "",
                  startDate: dayKey(event.startDate),
                  endDate: dayKey(event.endDate),
                  status: event.status,
                }}
              />
            </span>
          </div>
          <dl className="space-y-2 text-sm font-light">
            {row("Name", event.name)}
            {row("Dates", `${formatRange(event.startDate, event.endDate)} · ${nightsBetween(event.startDate, event.endDate)} nights`)}
            {row("City", event.city ?? "—")}
            {row("Country", event.country ?? "—")}
            {row("Status", statusLabels[event.status])}
          </dl>
        </Card>

        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-ink-900 text-[15px] font-medium">The team</h2>
            <span className="text-[13px] font-light">
              <EventSetupPopup
                part="team"
                eventId={event.id}
                eventName={event.name}
                label={event.projectLead || event.accommodationManagers.length ? "Change the team" : "Set the team"}
                projectLeadId={event.projectLead?.id ?? null}
                accommodationManagerIds={event.accommodationManagers.map((manager) => manager.id)}
              />
            </span>
          </div>
          <dl className="space-y-2 text-sm font-light">
            {row("Project lead", event.projectLead ? person(event.projectLead) : <span className="text-ink-500">Nobody yet</span>)}
            {row(
              "Accommodation managers",
              event.accommodationManagers.length ? event.accommodationManagers.map(person).join(", ") : <span className="text-ink-500">Nobody yet</span>,
            )}
          </dl>
          <p className="text-ink-500 mt-3 text-xs font-light">
            Each new sales request&apos;s sourcing task goes to the accommodation managers, and the project lead is told.
          </p>
        </Card>

        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-ink-900 text-[15px] font-medium">Places of interest</h2>
            <span className="text-[13px] font-light">
              <EventSetupPopup
                part="places"
                eventId={event.id}
                eventName={event.name}
                label={event.placesOfInterest.length ? "Change places of interest" : "Add places of interest"}
              />
            </span>
          </div>
          {event.placesOfInterest.length === 0 ? (
            <p className="text-ink-500 text-sm font-light">None yet — distances and travel times are measured to these.</p>
          ) : (
            <ul className="space-y-2 text-sm font-light">
              {event.placesOfInterest.slice(0, 12).map((place) => (
                <li key={place.id}>
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: place.layer?.color ?? "#9a9a9a" }} />
                  <span className="text-ink-900 font-medium">{place.name}</span>
                  <span className="text-ink-500"> · {place.layer?.name ?? placeCategoryLabels[place.category]}</span>
                  {place.address && <span className="text-ink-500 block text-xs">{place.address}</span>}
                </li>
              ))}
            </ul>
          )}
          {event.placesOfInterest.length > 12 && (
            <p className="text-ink-500 mt-2 text-xs font-light">…and {event.placesOfInterest.length - 12} more — all of them under Change places of interest.</p>
          )}
          <p className="text-ink-500 mt-3 text-xs font-light">
            Map layers — adding, importing from Google My Maps, choosing which are measured to — are run from the Layers panel on the Properties tab&apos;s map.
          </p>
        </Card>
          <HistorySection entity="Event" entityId={event.id} className="" />
      </div>
    </>
  );
}

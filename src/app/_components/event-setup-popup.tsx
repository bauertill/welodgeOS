"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EventTeam } from "~/app/_components/event-team";
import { PlacesOfInterest } from "~/app/_components/places-of-interest";
import { Popup } from "~/app/_components/popup";

/**
 * A part of the event's setup changed in a popup, from the Properties tab
 * (doc §2.3, §3.7) — so nobody leaves the board to do it. The same sections
 * as on the event's Edit page; the page behind is refreshed on closing.
 */
export function EventSetupPopup(
  props:
    | { part: "places"; eventId: string; eventName: string; label: string }
    | { part: "team"; eventId: string; eventName: string; label: string; projectLeadId: string | null; accommodationManagerIds: string[] },
) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-brand-700 hover:underline">
        {props.label}
      </button>
      {open && (
        <Popup
          title={props.part === "places" ? "Places of interest" : "The team"}
          subtitle={props.eventName}
          size={props.part === "places" ? "large" : "medium"}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          {props.part === "places" ? (
            <PlacesOfInterest eventId={props.eventId} />
          ) : (
            <EventTeam eventId={props.eventId} projectLeadId={props.projectLeadId} accommodationManagerIds={props.accommodationManagerIds} />
          )}
        </Popup>
      )}
    </>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { emptyProperty, PropertyForm } from "~/app/_components/property-form";
import { api } from "~/trpc/react";

/**
 * Scouting a property as a pop-up over the event's Properties tab, so scouting
 * does not leave the list (doc §3.1). It is the whole form, in tabs. Closing it
 * asks first once anything has been typed.
 */
export function ScoutPopup({ event, onClose }: { event: { id: string; name: string }; onClose: () => void }) {
  const amenities = api.amenity.list.useQuery();
  const names = api.property.listNames.useQuery();
  const dirty = useRef(false);
  const close = () => {
    if (dirty.current && !window.confirm("Close without saving this property?")) return;
    onClose();
  };
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onEscape);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, []);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[1010] bg-black/30" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scout a property"
        className="bg-ink-50 fixed inset-x-3 top-4 bottom-4 z-[1020] mx-auto max-w-4xl overflow-y-auto rounded-2xl p-6 shadow-2xl sm:inset-x-6"
        style={{ backgroundColor: "#f3f3f3" }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-ink-900 text-xl font-semibold">Scout a property</h2>
            <p className="text-ink-500 mt-0.5 text-sm font-light">It is added to {event.name}&apos;s list once saved.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-ink-400 hover:text-ink-900 text-2xl leading-none">
            ×
          </button>
        </div>
        {amenities.data && names.data ? (
          <PropertyForm
            initial={emptyProperty}
            amenities={amenities.data}
            existingNames={names.data}
            addToEventId={event.id}
            addToEventName={event.name}
            onSaved={onClose}
            onCancel={close}
            onDirtyChange={(value) => {
              dirty.current = value;
            }}
          />
        ) : (
          <p className="text-ink-500 text-sm font-light">Loading…</p>
        )}
      </div>
    </>,
    document.body,
  );
}

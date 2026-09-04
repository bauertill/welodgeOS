"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Select } from "~/app/_components/form";
import { propertyTypeLabels } from "~/lib/scouting";
import { api } from "~/trpc/react";

/**
 * Puts an already-scouted property onto this event's list, or sends you off to
 * scout a new one. Properties are scouted once and reused (doc §2.3).
 */
export function AddToList({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState("");

  const candidates = api.scouting.candidates.useQuery({ eventId });
  const add = api.scouting.add.useMutation({
    onSuccess: () => {
      setPropertyId("");
      void candidates.refetch();
      router.refresh();
    },
  });

  const options = candidates.data ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.length > 0 && (
        <>
          <Select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="w-64"
          >
            <option value="">Add an existing property…</option>
            {options.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
                {property.city ? ` — ${property.city}` : ""} (
                {propertyTypeLabels[property.type]})
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            disabled={!propertyId || add.isPending}
            onClick={() => add.mutate({ eventId, propertyId })}
          >
            {add.isPending ? "Adding…" : "Add"}
          </Button>
        </>
      )}

      <Link
        href={`/properties/new?event=${eventId}`}
        className="bg-brand-400 hover:bg-brand-500 inline-flex rounded-full px-5 py-2.5 text-[13px] font-light text-white transition-colors"
      >
        Scout a new property
      </Link>
    </div>
  );
}

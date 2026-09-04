"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/app/_components/form";
import { api } from "~/trpc/react";

/**
 * Deletes a property from the shared library outright — distinct from a
 * scouting list's "Remove", which only takes it off one event's list. The
 * server refuses this while the property is still scouted anywhere or
 * carries booked inventory, so a confirm dialog is enough here; the real
 * guard lives in the mutation.
 */
export function DeleteProperty({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const remove = api.property.remove.useMutation({
    onSuccess: () => {
      router.push("/properties");
      router.refresh();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        type="button"
        variant="danger"
        disabled={remove.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Delete "${name}"? This removes it from the library for every event, and cannot be undone.`,
            )
          ) {
            remove.mutate({ id });
          }
        }}
      >
        {remove.isPending ? "Deleting…" : "Delete"}
      </Button>
      {error && <p className="max-w-xs text-right text-xs text-[#c03654]">{error}</p>}
    </div>
  );
}

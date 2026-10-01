"use client";

import { useState } from "react";

import { CancellationsBoard, ContractsList, PaymentsBoard } from "~/app/_components/finance";

/**
 * An event's Contracts tab (doc §7.1): its contracts on both sides, and the
 * payments and cancellation deadlines they schedule.
 */
export function EventContracts({ eventId }: { eventId: string }) {
  const [view, setView] = useState<"contracts" | "payments" | "cancellations">("contracts");
  const tab = (value: typeof view, label: string) => (
    <button
      type="button"
      onClick={() => setView(value)}
      aria-pressed={view === value}
      className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
        view === value ? "bg-ink-900 font-medium text-white" : "text-ink-500 hover:text-ink-900 bg-white font-light"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tab("contracts", "Contracts")}
        {tab("payments", "Payments")}
        {tab("cancellations", "Cancellation deadlines")}
      </div>
      {view === "contracts" && <ContractsList eventId={eventId} />}
      {view === "payments" && <PaymentsBoard eventId={eventId} />}
      {view === "cancellations" && <CancellationsBoard eventId={eventId} />}
    </div>
  );
}

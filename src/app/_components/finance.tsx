"use client";

import { keepPreviousData } from "@tanstack/react-query";
import type { CancellationKind, ContractParty, PaymentStatus } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Manager } from "~/app/_components/client-list";
import { Combobox } from "~/app/_components/combobox";
import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Card, EmptyState } from "~/app/_components/ui";
import { daysUntil, dayKey } from "~/lib/dates";
import { formatDate, formatMoney } from "~/lib/format";
import {
  cancellationKindHints,
  cancellationKindLabels,
  cancellationKindOrder,
  isSettled,
  partyLabels,
  paymentStatusLabels,
  paymentStatusOrder,
  paymentStatusStyles,
  percent,
} from "~/lib/finance";
import { api, type RouterOutputs } from "~/trpc/react";

type FullContract = NonNullable<RouterOutputs["finance"]["contract"]>;
type Payment = FullContract["payments"][number];
type Cancellation = FullContract["cancellations"][number];

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];
const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
const td = "border-ink-200/40 border-b px-3 py-2.5 align-top text-[13px] font-light";

const money = (cents: number | null, currency: string | null) =>
  cents === null || !currency ? "—" : formatMoney(cents, currency);
const dayInput = (value: Date | null) => (value ? dayKey(value) : "");
/** "20" or "20.5" for a box, from hundredths of a percent. */
const shareInput = (basisPoints: number | null) => (basisPoints === null ? "" : String(basisPoints / 100));
const parseShare = (value: string) => {
  if (!value.trim()) return null;
  const n = Number(value.replace(",", ".").replace("%", ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : NaN;
};
const parseMoney = (value: string) => {
  if (!value.trim()) return null;
  const n = Number(value.replace(/[’'\s,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};

/** "In 5 days", "Today", "3 days overdue" — coloured once it matters. */
export function DueIn({ on, settled }: { on: Date; settled?: boolean }) {
  const days = daysUntil(on);
  if (settled) return <span className="text-ink-500 whitespace-nowrap">{formatDate(on)}</span>;
  const words = days === 0 ? "Today" : days > 0 ? `In ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} overdue`;
  const tone = days < 0 ? "font-medium text-[#c03654]" : days <= 7 ? "font-medium text-[#9a6512]" : "";
  return (
    <span className={`whitespace-nowrap ${tone}`}>
      {formatDate(on)}
      <span className={`block text-xs font-light ${days > 7 ? "text-ink-500" : ""}`}>{words}</span>
    </span>
  );
}

function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="bg-ink-50 flex rounded-lg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`rounded-md px-3 py-1.5 text-[13px] ${
            value === option.value ? "text-ink-900 bg-white font-medium shadow-sm" : "text-ink-500 hover:text-ink-900 font-light"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function EventFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const events = api.event.list.useQuery();
  return (
    <div className="w-52">
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Event">
        <option value="">Every event</option>
        {(events.data ?? []).map((event) => (
          <option key={event.id} value={event.id}>
            {event.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Per currency, never converted (doc §7). */
function Totals({ rows }: { rows: { cents: number | null; currency: string | null }[] }) {
  const sums = new Map<string, number>();
  for (const row of rows) if (row.cents !== null && row.currency) sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.cents);
  if (sums.size === 0) return null;
  return <span>{[...sums].map(([currency, cents]) => formatMoney(cents, currency)).join(" · ")}</span>;
}

// --- Payments -----------------------------------------------------------------------

/** Money we owe suppliers, or clients owe us, soonest first (doc §7.1). */
export function PaymentsBoard() {
  const [party, setParty] = useState<ContractParty>("SUPPLIER");
  const [show, setShow] = useState<"open" | "settled" | "all">("open");
  const [eventId, setEventId] = useState("");
  const utils = api.useUtils();
  const payments = api.finance.payments.useQuery({ party, show, eventId: eventId || undefined }, { placeholderData: keepPreviousData });
  const setStatus = api.finance.setPaymentStatus.useMutation({ onSuccess: () => void utils.finance.invalidate() });
  const rows = payments.data ?? [];
  const overdue = rows.filter((row) => !isSettled(row.status) && daysUntil(row.dueOn) < 0);
  const soon = rows.filter((row) => !isSettled(row.status) && daysUntil(row.dueOn) >= 0 && daysUntil(row.dueOn) <= 7);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={party}
          onChange={setParty}
          options={[
            { value: "SUPPLIER", label: "To suppliers" },
            { value: "CLIENT", label: "From clients" },
          ]}
        />
        <div className="w-32">
          <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Which payments">
            <option value="open">Open</option>
            <option value="settled">Paid</option>
            <option value="all">All</option>
          </Select>
        </div>
        <EventFilter value={eventId} onChange={setEventId} />
      </div>

      {(overdue.length > 0 || soon.length > 0) && (
        <p className={`rounded-lg px-3 py-2 text-[13px] ${overdue.length ? "bg-[#fde8ec] text-[#a3243d]" : "bg-[#fdf1dc] text-[#8a5a0f]"}`}>
          {overdue.length > 0 && (
            <>
              <span className="font-medium">{overdue.length} overdue</span> (
              <Totals rows={overdue.map((row) => ({ cents: row.amount, currency: row.contract.currency }))} />)
            </>
          )}
          {overdue.length > 0 && soon.length > 0 && " · "}
          {soon.length > 0 && (
            <>
              <span className="font-medium">{soon.length} due in the next 7 days</span> (
              <Totals rows={soon.map((row) => ({ cents: row.amount, currency: row.contract.currency }))} />)
            </>
          )}
        </p>
      )}

      {rows.length === 0 && !payments.isLoading ? (
        <EmptyState
          title={show === "settled" ? "Nothing paid yet" : "No open payments"}
          description="Payments come from a contract's payment terms — open a contract to add them."
        />
      ) : (
        <div className="border-ink-200/60 overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left">
            <thead className="bg-ink-50/60">
              <tr>
                <th className={th}>Due</th>
                <th className={th}>{party === "SUPPLIER" ? "Supplier" : "Client"}</th>
                <th className={th}>Event</th>
                <th className={th}>Payment</th>
                <th className={th}>Share</th>
                <th className={th}>Amount</th>
                <th className={th}>Status</th>
                <th className={th}>Documents</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={td}>
                    <DueIn on={row.dueOn} settled={isSettled(row.status)} />
                  </td>
                  <td className={`${td} text-ink-900`}>
                    <Link href={`/finances/contracts/${row.contract.id}`} className="hover:text-brand-700 font-medium">
                      {row.counterparty}
                    </Link>
                    <span className="text-ink-500 block text-xs">{row.contract.name}</span>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{row.contract.event.name}</td>
                  <td className={`${td} max-w-72`}>
                    <span className="line-clamp-2">{row.description}</span>
                    {row.beneficiary && <span className="text-ink-500 block text-xs">To {row.beneficiary}</span>}
                  </td>
                  <td className={td}>{percent(row.percentBasisPoints) ?? "Set amount"}</td>
                  <td className={`${td} whitespace-nowrap`}>{money(row.amount, row.contract.currency)}</td>
                  <td className={td}>
                    <Select
                      value={row.status}
                      onChange={(e) => setStatus.mutate({ id: row.id, status: e.target.value as PaymentStatus })}
                      aria-label="Status"
                      className={`w-40 py-1 text-[12px] ${paymentStatusStyles[row.status]}`}
                    >
                      {paymentStatusOrder[party].map((status) => (
                        <option key={status} value={status}>
                          {paymentStatusLabels[status]}
                        </option>
                      ))}
                    </Select>
                    {row.paidOn && <span className="text-ink-500 mt-1 block text-xs">on {formatDate(row.paidOn)}</span>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {row.invoiceUrl && (
                      <a href={row.invoiceUrl} target="_blank" rel="noreferrer" className="text-brand-700 mr-2 text-xs hover:underline">
                        Invoice ↗
                      </a>
                    )}
                    {row.proofUrl && (
                      <a href={row.proofUrl} target="_blank" rel="noreferrer" className="text-brand-700 text-xs hover:underline">
                        Proof ↗
                      </a>
                    )}
                    {!row.invoiceUrl && !row.proofUrl && <span className="text-ink-500">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {setStatus.error && <FormError message={friendlyError(setStatus.error)} />}
      <p className="text-ink-500 text-xs font-light">
        Each payment is a share of its contract&apos;s total, worked out from the total each time — change the total on
        the contract and every share follows. Totals are per currency, never converted.
      </p>
    </div>
  );
}

// --- Cancellations --------------------------------------------------------------------

/** Cut-offs by which rooms may be given back — ours with suppliers, clients' with us (doc §7.1). */
export function CancellationsBoard() {
  const [party, setParty] = useState<ContractParty>("SUPPLIER");
  const [show, setShow] = useState<"open" | "handled" | "all">("open");
  const [eventId, setEventId] = useState("");
  const utils = api.useUtils();
  const rows = api.finance.cancellations.useQuery({ party, show, eventId: eventId || undefined }, { placeholderData: keepPreviousData });
  const handled = api.finance.setHandled.useMutation({ onSuccess: () => void utils.finance.invalidate() });
  const data = rows.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={party}
          onChange={setParty}
          options={[
            { value: "SUPPLIER", label: "With suppliers" },
            { value: "CLIENT", label: "With clients" },
          ]}
        />
        <div className="w-36">
          <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Which deadlines">
            <option value="open">Still open</option>
            <option value="handled">Dealt with</option>
            <option value="all">All</option>
          </Select>
        </div>
        <EventFilter value={eventId} onChange={setEventId} />
      </div>

      {data.length === 0 && !rows.isLoading ? (
        <EmptyState
          title={show === "handled" ? "Nothing dealt with yet" : "No open cancellation deadlines"}
          description="They come from a contract's cancellation terms — open a contract to add them."
        />
      ) : (
        <div className="border-ink-200/60 overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left">
            <thead className="bg-ink-50/60">
              <tr>
                <th className={th}>Cut-off</th>
                <th className={th}>{party === "SUPPLIER" ? "Supplier" : "Client"}</th>
                <th className={th}>Event</th>
                <th className={th}>Kind</th>
                <th className={th}>Share</th>
                <th className={th}>Applies to</th>
                <th className={th}>Fee</th>
                <th className={th}>Remarks</th>
                <th className={th}>Dealt with</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id}>
                  <td className={td}>
                    <DueIn on={row.cutoffOn} settled={row.handledOn !== null} />
                  </td>
                  <td className={`${td} text-ink-900`}>
                    <Link href={`/finances/contracts/${row.contract.id}`} className="hover:text-brand-700 font-medium">
                      {row.counterparty}
                    </Link>
                    <span className="text-ink-500 block text-xs">{row.contract.name}</span>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{row.contract.event.name}</td>
                  <td className={td} title={cancellationKindHints[row.kind]}>
                    {cancellationKindLabels[row.kind]}
                  </td>
                  <td className={td}>{percent(row.percentBasisPoints) ?? "—"}</td>
                  <td className={`${td} max-w-56`}>
                    {row.appliesTo ?? "—"}
                    {row.roomType && <span className="text-ink-500 block text-xs">{row.roomType}</span>}
                  </td>
                  <td className={td}>{percent(row.feeBasisPoints) ?? "—"}</td>
                  <td className={`${td} max-w-64`}>
                    <span className="line-clamp-2">{row.remarks ?? "—"}</span>
                  </td>
                  <td className={td}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="accent-brand-400 h-4 w-4"
                        checked={row.handledOn !== null}
                        onChange={(e) => handled.mutate({ id: row.id, handled: e.target.checked })}
                      />
                      {row.handledOn ? formatDate(row.handledOn) : "Not yet"}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-ink-500 text-xs font-light">
        A cut-off is a reminder: nothing is released or cancelled on its own. Tick it once someone has dealt with it.
      </p>
    </div>
  );
}

// --- Contracts ------------------------------------------------------------------------

/** Every contract, flagging the ones still missing their terms. */
export function ContractsList() {
  const [party, setParty] = useState<ContractParty | "">("");
  const [eventId, setEventId] = useState("");
  const contracts = api.finance.contracts.useQuery(
    { party: party || undefined, eventId: eventId || undefined },
    { placeholderData: keepPreviousData },
  );
  const rows = contracts.data ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={party}
          onChange={setParty}
          options={[
            { value: "", label: "All" },
            { value: "SUPPLIER", label: "Suppliers" },
            { value: "CLIENT", label: "Clients" },
          ]}
        />
        <EventFilter value={eventId} onChange={setEventId} />
      </div>
      {rows.length === 0 && !contracts.isLoading ? (
        <EmptyState title="No contracts yet" description="Add one with + New contract, or from a sales request." />
      ) : (
        <div className="border-ink-200/60 overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left">
            <thead className="bg-ink-50/60">
              <tr>
                <th className={th}>Contract</th>
                <th className={th}>With</th>
                <th className={th}>Event</th>
                <th className={th}>Total</th>
                <th className={th}>Terms</th>
                <th className={th}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((contract) => (
                <tr key={contract.id}>
                  <td className={`${td} text-ink-900`}>
                    <Link href={`/finances/contracts/${contract.id}`} className="hover:text-brand-700 font-medium">
                      {contract.name}
                    </Link>
                    <span className="text-ink-500 block text-xs">{partyLabels[contract.party]}</span>
                  </td>
                  <td className={td}>{contract.property?.name ?? contract.client?.name ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>{contract.event.name}</td>
                  <td className={`${td} whitespace-nowrap`}>{money(contract.totalCents, contract.currency)}</td>
                  <td className={td}>
                    {contract.missing.length ? (
                      <span className="font-medium text-[#c03654]">Missing {contract.missing.join(", ")}</span>
                    ) : (
                      <span className="text-[#0a7a47]">
                        {contract._count.payments} payment{contract._count.payments === 1 ? "" : "s"} ·{" "}
                        {contract.noCancellationTerms ? "no cancellation terms" : `${contract._count.cancellations} cancellation deadline${contract._count.cancellations === 1 ? "" : "s"}`}
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    {contract.documentUrl ? (
                      <a href={contract.documentUrl} target="_blank" rel="noreferrer" className="text-brand-700 text-xs hover:underline">
                        Open ↗
                      </a>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A new contract: who it is with, for which event, the total and the PDF.
 * Its payment and cancellation terms are added on its page, after.
 */
export function NewContractForm({
  preset,
}: {
  preset?: { party?: ContractParty; eventId?: string; clientId?: string; propertyId?: string; salesRequestId?: string; totalCents?: number | null; currency?: string | null };
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const events = api.event.list.useQuery();
  const [party, setParty] = useState<ContractParty>(preset?.party ?? "SUPPLIER");
  const [eventId, setEventId] = useState(preset?.eventId ?? "");
  const [withId, setWithId] = useState(preset?.clientId ?? preset?.propertyId ?? "");
  const [name, setName] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [signedOn, setSignedOn] = useState("");
  const [total, setTotal] = useState(preset?.totalCents != null ? (preset.totalCents / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(preset?.currency ?? "USD");
  const [problem, setProblem] = useState<string | null>(null);
  const options = api.finance.counterparties.useQuery({ eventId, party }, { enabled: Boolean(eventId) });
  const create = api.finance.createContract.useMutation({
    onSuccess: (contract) => {
      void utils.finance.invalidate();
      router.push(`/finances/contracts/${contract.id}`);
    },
  });

  return (
    <Card>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setProblem(null);
          const cents = parseMoney(total);
          if (Number.isNaN(cents)) return setProblem("The total should be a number, like 198450.");
          create.mutate({
            party,
            eventId,
            ...(party === "SUPPLIER" ? { propertyId: withId } : { clientId: withId, salesRequestId: preset?.salesRequestId }),
            name,
            documentUrl,
            signedOn,
            totalCents: cents,
            currency,
          });
        }}
      >
        <Field label="With">
          <Tabs
            value={party}
            onChange={(value) => {
              setParty(value);
              setWithId("");
            }}
            options={[
              { value: "SUPPLIER", label: "A supplier" },
              { value: "CLIENT", label: "A client" },
            ]}
          />
        </Field>
        <Field label="Event">
          <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Choose…</option>
            {(events.data ?? []).map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <span className="text-ink-700 mb-1.5 block text-[13px] font-medium">{party === "SUPPLIER" ? "Hotel" : "Client"}</span>
          <Combobox
            value={withId}
            onChange={setWithId}
            placeholder={eventId ? (party === "SUPPLIER" ? "Choose a hotel on this event" : "Choose a client") : "Choose the event first"}
            options={options.data ?? []}
          />
        </div>
        <Field label="Contract name" className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group Sales Agreement" />
        </Field>
        <Field label="Signed PDF — Google Drive link" hint="Open the file in Drive, Share → Copy link, and paste it here." className="sm:col-span-2">
          <Input value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…" />
        </Field>
        <Field label="Signed on">
          <Input type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
        </Field>
        <Field label="Total of the contract" hint="What the whole contract is worth. Every payment is a share of this.">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="198450" aria-label="Total" />
            </div>
            <div className="w-24 shrink-0">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                {CURRENCIES.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </Select>
            </div>
          </div>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <FormError message={problem ?? (create.error ? friendlyError(create.error) : null)} />
          <Button type="submit" disabled={create.isPending || !eventId || !withId || !name.trim()}>
            {create.isPending ? "Adding…" : "Add contract"}
          </Button>
          <p className="text-ink-500 text-xs font-light">Its payment and cancellation terms are added on the next page.</p>
        </div>
      </form>
    </Card>
  );
}

// --- One contract -----------------------------------------------------------------------

function useSaved() {
  const router = useRouter();
  const utils = api.useUtils();
  return () => {
    void utils.finance.invalidate();
    void utils.audit.invalidate();
    router.refresh();
  };
}

export function ContractView({ contract }: { contract: FullContract }) {
  return (
    <div className="space-y-5">
      {contract.missing.length > 0 && (
        <p className="rounded-xl border-2 border-[#c03654] bg-[#fde8ec] px-4 py-3 text-[13px] text-[#8e1f36]">
          <span className="font-semibold">This contract is missing {contract.missing.join(", ")}.</span> Rooms can be bought or
          sold under it meanwhile, but it stays flagged until they are added.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <PaymentsCard contract={contract} />
          <CancellationsCard contract={contract} />
        </div>
        <ContractDetails contract={contract} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-500 w-32 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 break-words whitespace-pre-line">{value ?? "—"}</dd>
    </div>
  );
}

function ContractDetails({ contract }: { contract: FullContract }) {
  const [editing, setEditing] = useState(false);
  const saved = useSaved();
  const people = api.user.list.useQuery();
  const update = api.finance.updateContract.useMutation({
    onSuccess: () => {
      saved();
      setEditing(false);
    },
  });
  const [draft, setDraft] = useState({
    name: contract.name,
    documentUrl: contract.documentUrl ?? "",
    signedOn: dayInput(contract.signedOn),
    total: contract.totalCents !== null ? (contract.totalCents / 100).toFixed(2) : "",
    currency: contract.currency ?? "USD",
    ownerId: contract.owner?.id ?? "",
    notes: contract.notes ?? "",
    noCancellationTerms: contract.noCancellationTerms,
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Contract</h2>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-light hover:underline">
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            const cents = parseMoney(draft.total);
            if (Number.isNaN(cents)) return setProblem("The total should be a number, like 198450.");
            update.mutate({
              id: contract.id,
              name: draft.name,
              documentUrl: draft.documentUrl,
              signedOn: draft.signedOn,
              totalCents: cents,
              currency: draft.currency,
              ownerId: draft.ownerId || null,
              notes: draft.notes,
              noCancellationTerms: draft.noCancellationTerms,
            });
          }}
        >
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} />
          </Field>
          <Field label="Signed PDF — Google Drive link">
            <Input value={draft.documentUrl} onChange={(e) => set("documentUrl")(e.target.value)} placeholder="https://drive.google.com/file/d/…" />
          </Field>
          <Field label="Signed on">
            <Input type="date" value={draft.signedOn} onChange={(e) => set("signedOn")(e.target.value)} />
          </Field>
          <Field label="Total">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input value={draft.total} onChange={(e) => set("total")(e.target.value)} inputMode="decimal" aria-label="Total" />
              </div>
              <div className="w-24 shrink-0">
                <Select value={draft.currency} onChange={(e) => set("currency")(e.target.value)} aria-label="Currency">
                  {CURRENCIES.map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </Select>
              </div>
            </div>
          </Field>
          <Field label="Account manager">
            <Select value={draft.ownerId} onChange={(e) => set("ownerId")(e.target.value)}>
              <option value="">Nobody yet</option>
              {(people.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? person.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={draft.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-[13px] font-light">
            <input
              type="checkbox"
              className="accent-brand-400 mt-0.5 h-4 w-4"
              checked={draft.noCancellationTerms}
              onChange={(e) => set("noCancellationTerms")(e.target.checked)}
            />
            This contract has no cancellation deadlines at all
          </label>
          <FormError message={problem ?? (update.error ? friendlyError(update.error) : null)} />
          <div className="flex gap-2">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="space-y-2 text-sm font-light">
          <Row label="With" value={`${contract.property?.name ?? contract.client?.name ?? "—"} (${partyLabels[contract.party].toLowerCase()})`} />
          <Row
            label="Event"
            value={
              <Link href={`/events/${contract.event.id}/inventory`} className="text-brand-700 hover:underline">
                {contract.event.name}
              </Link>
            }
          />
          {contract.salesRequest && (
            <Row
              label="Sales request"
              value={
                <Link href={`/sales/${contract.salesRequest.id}`} className="text-brand-700 hover:underline">
                  Open the request
                </Link>
              }
            />
          )}
          <Row label="Total" value={money(contract.totalCents, contract.currency)} />
          <Row
            label="Signed PDF"
            value={
              contract.documentUrl ? (
                <a href={contract.documentUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                  Open in Drive ↗
                </a>
              ) : null
            }
          />
          <Row label="Signed on" value={contract.signedOn ? formatDate(contract.signedOn) : null} />
          <Row label="Account manager" value={contract.owner ? <Manager person={contract.owner} /> : null} />
          <Row label="Room-nights" value={String(contract.party === "SUPPLIER" ? contract._count.acquisitionNights : contract._count.salesNights)} />
          {contract.notes && <Row label="Notes" value={contract.notes} />}
        </dl>
      )}
    </Card>
  );
}

function PaymentsCard({ contract }: { contract: FullContract }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const saved = useSaved();
  const setStatus = api.finance.setPaymentStatus.useMutation({ onSuccess: saved });
  const shareTotal = contract.payments.reduce((sum, payment) => sum + (payment.percentBasisPoints ?? 0), 0);
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Payment terms</h2>
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="text-brand-700 text-[13px] font-medium hover:underline">
            + Add payment
          </button>
        )}
      </div>
      {editing === "new" && <PaymentEditor contract={contract} onDone={() => setEditing(null)} />}
      {contract.payments.length === 0 ? (
        editing !== "new" && (
          <p className="text-sm font-light text-[#c03654]">
            No payment terms yet. Add each payment in the contract — a share of the total and its due date.
          </p>
        )
      ) : (
        <div className="border-ink-200/60 overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            <thead className="bg-ink-50/60">
              <tr>
                <th className={th}>Due</th>
                <th className={th}>Payment</th>
                <th className={th}>Share</th>
                <th className={th}>Amount</th>
                <th className={th}>Status</th>
                <th className={th}>{""}</th>
              </tr>
            </thead>
            <tbody>
              {contract.payments.map((payment) =>
                editing === payment.id ? (
                  <tr key={payment.id}>
                    <td colSpan={6} className="border-ink-200/40 bg-brand-50/40 border-b p-3">
                      <PaymentEditor contract={contract} payment={payment} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={payment.id}>
                    <td className={td}>
                      <DueIn on={payment.dueOn} settled={isSettled(payment.status)} />
                    </td>
                    <td className={`${td} max-w-64`}>{payment.description}</td>
                    <td className={td}>{percent(payment.percentBasisPoints) ?? "Set amount"}</td>
                    <td className={`${td} whitespace-nowrap`}>{money(payment.amount, contract.currency)}</td>
                    <td className={td}>
                      <Select
                        value={payment.status}
                        onChange={(e) => setStatus.mutate({ id: payment.id, status: e.target.value as PaymentStatus })}
                        aria-label="Status"
                        className={`w-40 py-1 text-[12px] ${paymentStatusStyles[payment.status]}`}
                      >
                        {paymentStatusOrder[contract.party].map((status) => (
                          <option key={status} value={status}>
                            {paymentStatusLabels[status]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className={td}>
                      {editing === null && (
                        <button type="button" onClick={() => setEditing(payment.id)} className="text-brand-700 text-xs hover:underline">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {contract.payments.length > 0 && (
        <p className={`mt-2 text-xs font-light ${shareTotal !== 10_000 && contract.payments.every((p) => p.percentBasisPoints !== null) ? "text-[#9a6512]" : "text-ink-500"}`}>
          Shares add up to {percent(shareTotal)} of {money(contract.totalCents, contract.currency)}
          {shareTotal !== 10_000 && contract.payments.every((p) => p.percentBasisPoints !== null) ? " — not 100%: check the terms." : "."}
        </p>
      )}
    </Card>
  );
}

function PaymentEditor({ contract, payment, onDone }: { contract: FullContract; payment?: Payment; onDone: () => void }) {
  const saved = useSaved();
  const [draft, setDraft] = useState({
    description: payment?.description ?? "",
    dueOn: dayInput(payment?.dueOn ?? null),
    share: shareInput(payment?.percentBasisPoints ?? null),
    amount: payment?.amountCents != null ? (payment.amountCents / 100).toFixed(2) : "",
    status: payment?.status ?? ("TO_BE_PAID" as PaymentStatus),
    paidOn: dayInput(payment?.paidOn ?? null),
    invoiceUrl: payment?.invoiceUrl ?? "",
    proofUrl: payment?.proofUrl ?? "",
    beneficiary: payment?.beneficiary ?? "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const save = api.finance.savePayment.useMutation({ onSuccess: () => { saved(); onDone(); } });
  const remove = api.finance.removePayment.useMutation({ onSuccess: () => { saved(); onDone(); } });
  const share = parseShare(draft.share);
  const preview =
    share !== null && !Number.isNaN(share) && contract.totalCents !== null
      ? money(Math.round((contract.totalCents * share) / 10_000), contract.currency)
      : null;

  return (
    <form
      className="mb-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        const amount = parseMoney(draft.amount);
        if (Number.isNaN(share)) return setProblem("The share should be a percentage between 0 and 100, like 20.");
        if (Number.isNaN(amount)) return setProblem("The amount should be a number, like 39690.");
        if (share === null && amount === null) return setProblem("Give the payment's share of the total, like 20 — or a set amount.");
        if (!draft.dueOn) return setProblem("Give the date the payment is due.");
        save.mutate({
          contractId: contract.id,
          id: payment?.id,
          payment: {
            description: draft.description,
            dueOn: draft.dueOn,
            percentBasisPoints: share,
            amountCents: share !== null ? null : amount,
            status: draft.status,
            paidOn: draft.paidOn,
            invoiceUrl: draft.invoiceUrl,
            proofUrl: draft.proofUrl,
            beneficiary: draft.beneficiary,
          },
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Payment" className="sm:col-span-3">
          <Input value={draft.description} onChange={(e) => set("description")(e.target.value)} placeholder="1st deposit" autoFocus />
        </Field>
        <Field label="Due on" className="sm:col-span-3">
          <Input type="date" value={draft.dueOn} onChange={(e) => set("dueOn")(e.target.value)} />
        </Field>
        <Field label="Share of the total, %" hint={preview ? `= ${preview}` : contract.totalCents === null ? "Give the contract its total to see the amount." : undefined} className="sm:col-span-2">
          <Input value={draft.share} onChange={(e) => set("share")(e.target.value)} inputMode="decimal" placeholder="20" />
        </Field>
        <Field label="Or a set amount" hint="Only where it is not a plain share, like a tax." className="sm:col-span-2">
          <Input value={draft.amount} onChange={(e) => set("amount")(e.target.value)} inputMode="decimal" placeholder="—" disabled={draft.share.trim() !== ""} />
        </Field>
        <Field label="Status" className="sm:col-span-2">
          <Select value={draft.status} onChange={(e) => set("status")(e.target.value)}>
            {paymentStatusOrder[contract.party].map((status) => (
              <option key={status} value={status}>
                {paymentStatusLabels[status]}
              </option>
            ))}
          </Select>
        </Field>
        {isSettled(draft.status) && (
          <Field label="Paid on" className="sm:col-span-2">
            <Input type="date" value={draft.paidOn} onChange={(e) => set("paidOn")(e.target.value)} />
          </Field>
        )}
        <Field label={contract.party === "SUPPLIER" ? "Invoice from the supplier — link" : "Our invoice — link"} className="sm:col-span-3">
          <Input value={draft.invoiceUrl} onChange={(e) => set("invoiceUrl")(e.target.value)} placeholder="https://drive.google.com/…" />
        </Field>
        <Field label="Proof of payment — link" className="sm:col-span-3">
          <Input value={draft.proofUrl} onChange={(e) => set("proofUrl")(e.target.value)} placeholder="https://drive.google.com/…" />
        </Field>
        {contract.party === "SUPPLIER" && (
          <Field label="Beneficiary" className="sm:col-span-6">
            <Input value={draft.beneficiary} onChange={(e) => set("beneficiary")(e.target.value)} placeholder="The account holder's name" />
          </Field>
        )}
      </div>
      <FormError message={problem ?? (save.error ? friendlyError(save.error) : remove.error ? friendlyError(remove.error) : null)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : payment ? "Save" : "Add payment"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {payment && (
          <button
            type="button"
            onClick={() => window.confirm(`Remove “${payment.description}”?`) && remove.mutate({ id: payment.id })}
            className="ml-auto text-xs font-light text-[#c03654] hover:underline"
          >
            Remove payment
          </button>
        )}
      </div>
    </form>
  );
}

function CancellationsCard({ contract }: { contract: FullContract }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const saved = useSaved();
  const handled = api.finance.setHandled.useMutation({ onSuccess: saved });
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Cancellation terms</h2>
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="text-brand-700 text-[13px] font-medium hover:underline">
            + Add deadline
          </button>
        )}
      </div>
      {editing === "new" && <CancellationEditor contract={contract} onDone={() => setEditing(null)} />}
      {contract.cancellations.length === 0 ? (
        editing !== "new" && (
          <p className={`text-sm font-light ${contract.noCancellationTerms ? "text-ink-500" : "text-[#c03654]"}`}>
            {contract.noCancellationTerms
              ? "This contract has no cancellation deadlines."
              : "No cancellation deadlines yet. Add each one in the contract — or, under Edit, say it has none."}
          </p>
        )
      ) : (
        <div className="border-ink-200/60 overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            <thead className="bg-ink-50/60">
              <tr>
                <th className={th}>Cut-off</th>
                <th className={th}>Kind</th>
                <th className={th}>Share</th>
                <th className={th}>Applies to</th>
                <th className={th}>Fee</th>
                <th className={th}>Dealt with</th>
                <th className={th}>{""}</th>
              </tr>
            </thead>
            <tbody>
              {contract.cancellations.map((cancellation) =>
                editing === cancellation.id ? (
                  <tr key={cancellation.id}>
                    <td colSpan={7} className="border-ink-200/40 bg-brand-50/40 border-b p-3">
                      <CancellationEditor contract={contract} cancellation={cancellation} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={cancellation.id}>
                    <td className={td}>
                      <DueIn on={cancellation.cutoffOn} settled={cancellation.handledOn !== null} />
                    </td>
                    <td className={td} title={cancellationKindHints[cancellation.kind]}>
                      {cancellationKindLabels[cancellation.kind]}
                      {cancellation.remarks && <span className="text-ink-500 line-clamp-2 block text-xs">{cancellation.remarks}</span>}
                    </td>
                    <td className={td}>{percent(cancellation.percentBasisPoints) ?? "—"}</td>
                    <td className={`${td} max-w-48`}>
                      {cancellation.appliesTo ?? "—"}
                      {cancellation.roomType && <span className="text-ink-500 block text-xs">{cancellation.roomType}</span>}
                    </td>
                    <td className={td}>{percent(cancellation.feeBasisPoints) ?? "—"}</td>
                    <td className={td}>
                      <input
                        type="checkbox"
                        className="accent-brand-400 h-4 w-4"
                        checked={cancellation.handledOn !== null}
                        onChange={(e) => handled.mutate({ id: cancellation.id, handled: e.target.checked })}
                        aria-label="Dealt with"
                      />
                    </td>
                    <td className={td}>
                      {editing === null && (
                        <button type="button" onClick={() => setEditing(cancellation.id)} className="text-brand-700 text-xs hover:underline">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CancellationEditor({
  contract,
  cancellation,
  onDone,
}: {
  contract: FullContract;
  cancellation?: Cancellation;
  onDone: () => void;
}) {
  const saved = useSaved();
  const kinds = cancellationKindOrder[contract.party];
  const [draft, setDraft] = useState({
    kind: cancellation?.kind ?? kinds[0]!,
    cutoffOn: dayInput(cancellation?.cutoffOn ?? null),
    share: shareInput(cancellation?.percentBasisPoints ?? null),
    appliesTo: cancellation?.appliesTo ?? "",
    roomType: cancellation?.roomType ?? "",
    fee: shareInput(cancellation?.feeBasisPoints ?? null),
    remarks: cancellation?.remarks ?? "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const save = api.finance.saveCancellation.useMutation({ onSuccess: () => { saved(); onDone(); } });
  const remove = api.finance.removeCancellation.useMutation({ onSuccess: () => { saved(); onDone(); } });

  return (
    <form
      className="mb-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        const share = parseShare(draft.share);
        const fee = parseShare(draft.fee);
        if (Number.isNaN(share) || Number.isNaN(fee)) return setProblem("Shares and fees are percentages between 0 and 100, like 10.");
        if (!draft.cutoffOn) return setProblem("Give the cut-off date.");
        save.mutate({
          contractId: contract.id,
          id: cancellation?.id,
          cancellation: {
            kind: draft.kind as CancellationKind,
            cutoffOn: draft.cutoffOn,
            percentBasisPoints: share,
            appliesTo: draft.appliesTo,
            roomType: draft.roomType,
            feeBasisPoints: fee,
            remarks: draft.remarks,
          },
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Kind" hint={cancellationKindHints[draft.kind as CancellationKind]} className="sm:col-span-3">
          <Select value={draft.kind} onChange={(e) => set("kind")(e.target.value)}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {cancellationKindLabels[kind]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cut-off date" className="sm:col-span-3">
          <Input type="date" value={draft.cutoffOn} onChange={(e) => set("cutoffOn")(e.target.value)} />
        </Field>
        <Field label="Share that may go, %" className="sm:col-span-2">
          <Input value={draft.share} onChange={(e) => set("share")(e.target.value)} inputMode="decimal" placeholder="10" />
        </Field>
        <Field label="Applies to" className="sm:col-span-2">
          <Input value={draft.appliesTo} onChange={(e) => set("appliesTo")(e.target.value)} placeholder="63 room-nights" />
        </Field>
        <Field label="Fee, %" className="sm:col-span-2">
          <Input value={draft.fee} onChange={(e) => set("fee")(e.target.value)} inputMode="decimal" placeholder="30" />
        </Field>
        <Field label="Room type" className="sm:col-span-2">
          <Input value={draft.roomType} onChange={(e) => set("roomType")(e.target.value)} placeholder="ROH (King)" />
        </Field>
        <Field label="Remarks" className="sm:col-span-4">
          <Input value={draft.remarks} onChange={(e) => set("remarks")(e.target.value)} placeholder="630 room-nights in total" />
        </Field>
      </div>
      <FormError message={problem ?? (save.error ? friendlyError(save.error) : remove.error ? friendlyError(remove.error) : null)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : cancellation ? "Save" : "Add deadline"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {cancellation && (
          <button
            type="button"
            onClick={() => window.confirm("Remove this cancellation deadline?") && remove.mutate({ id: cancellation.id })}
            className="ml-auto text-xs font-light text-[#c03654] hover:underline"
          >
            Remove deadline
          </button>
        )}
      </div>
    </form>
  );
}

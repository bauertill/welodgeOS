"use client";

import { keepPreviousData } from "@tanstack/react-query";
import type { SalesRequestStage } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Manager } from "~/app/_components/client-list";
import { Combobox } from "~/app/_components/combobox";
import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Card, EmptyState } from "~/app/_components/ui";
import { daysUntil, dayKey, today } from "~/lib/dates";
import { formatDate, formatMoney } from "~/lib/format";
import {
  closedStages,
  contractingFields,
  interestFields,
  isClosed,
  openStages,
  salesStageHints,
  salesStageLabels,
  salesStageOrder,
  salesStageStyles,
  type ContractingKey,
  type InterestKey,
} from "~/lib/sales";
import { api, type RouterOutputs } from "~/trpc/react";

type Request = RouterOutputs["sales"]["list"][number];
type FullRequest = NonNullable<RouterOutputs["sales"]["byId"]>;

const CURRENCIES = ["EUR", "USD", "CHF", "GBP"];

/** "2028-07-10" for a date box, or "" when there is none. */
const dayInput = (value: Date | null) => (value ? dayKey(value) : "");

export function StageBadge({ stage }: { stage: SalesRequestStage }) {
  return (
    <span
      title={salesStageHints[stage]}
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${salesStageStyles[stage]}`}
    >
      {salesStageLabels[stage]}
    </span>
  );
}

/** "Today", "In 3 days", "4 days overdue" — how pressing a follow-up is. */
function FollowUp({ on, closed }: { on: Date | null; closed: boolean }) {
  if (!on) return <span className="text-ink-500">—</span>;
  const days = daysUntil(on);
  const due = !closed && days <= 0;
  const words = days === 0 ? "Today" : days > 0 ? `In ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} overdue`;
  return (
    <span className={`whitespace-nowrap ${due ? "font-medium text-[#c03654]" : ""}`}>
      {formatDate(on)}
      {!closed && <span className={`block text-xs font-light ${due ? "" : "text-ink-500"}`}>{words}</span>}
    </span>
  );
}

/** Days from registering the request until it closed, or until today while open. */
const daysOpen = (request: { createdAt: Date; closedOn: Date | null }) =>
  Math.max(0, daysUntil(request.closedOn ?? today(), request.createdAt));

// --- The list -----------------------------------------------------------------

/** Every sales request, open ones grouped by stage, with who to chase first (doc §4.11). */
export function SalesRequestList() {
  const events = api.event.list.useQuery();
  const people = api.user.list.useQuery();
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [eventId, setEventId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  const requests = api.sales.list.useQuery(
    { show, eventId: eventId || undefined, ownerId: ownerId || undefined, dueOnly, q },
    { placeholderData: keepPreviousData },
  );
  const rows = requests.data ?? [];
  const due = rows.filter((request) => !isClosed(request.stage) && request.followUpOn && daysUntil(request.followUpOn) <= 0).length;
  const stages = show === "open" ? openStages : show === "closed" ? closedStages : salesStageOrder;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search client, contact or need" aria-label="Search sales requests" />
        </div>
        <div className="w-32">
          <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Which requests">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </Select>
        </div>
        <div className="w-48">
          <Select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
            <option value="">Every event</option>
            {(events.data ?? []).map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Account manager">
            <option value="">Every account manager</option>
            {(people.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.email}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-[13px] font-light">
          <input type="checkbox" className="accent-brand-400 h-4 w-4" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
          Follow-up due
        </label>
      </div>

      {show !== "closed" && due > 0 && !dueOnly && (
        <p className="rounded-lg bg-[#fde8ec] px-3 py-2 text-[13px] font-light text-[#a3243d]">
          {due} request{due === 1 ? " is" : "s are"} due a follow-up today or overdue.{" "}
          <button type="button" onClick={() => setDueOnly(true)} className="font-medium hover:underline">
            Show only those
          </button>
        </p>
      )}

      {rows.length === 0 && !requests.isLoading ? (
        <EmptyState
          title={q || eventId || ownerId || dueOnly ? "No request matches" : show === "closed" ? "Nothing closed yet" : "No open sales requests"}
          description="Register a client's interest with + New sales request, as soon as they share it."
        />
      ) : (
        stages.map((stage) => {
          const inStage = rows.filter((request) => request.stage === stage);
          if (inStage.length === 0) return null;
          return <StageGroup key={stage} stage={stage} requests={inStage} />;
        })
      )}
    </div>
  );
}

function StageGroup({ stage, requests }: { stage: SalesRequestStage; requests: Request[] }) {
  const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
  const td = "border-ink-200/40 border-b px-3 py-2.5 align-top text-[13px] font-light";
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[14px] font-medium">
        <StageBadge stage={stage} />
        <span className="text-ink-500 text-xs font-light">{requests.length}</span>
      </h2>
      <div className="border-ink-200/60 overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left">
          <thead className="bg-ink-50/60">
            <tr>
              <th className={th}>Client</th>
              <th className={th}>Event</th>
              <th className={th}>What they need</th>
              <th className={th}>Period</th>
              <th className={th}>Follow up</th>
              <th className={th}>Account manager</th>
              <th className={th}>Days open</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="hover:bg-ink-50/40">
                <td className={`${td} min-w-44`}>
                  <Link href={`/sales/${request.id}`} className="text-ink-900 hover:text-brand-700 font-medium">
                    {request.client.name}
                  </Link>
                  {request.contact && <span className="text-ink-500 block text-xs">{request.contact.name}</span>}
                </td>
                <td className={`${td} whitespace-nowrap`}>{request.event?.name ?? "—"}</td>
                <td className={`${td} max-w-80`}>
                  <span className="line-clamp-2">{request.description ?? request.rooms ?? "—"}</span>
                </td>
                <td className={`${td} max-w-44`}>
                  <span className="line-clamp-2">{request.period ?? "—"}</span>
                </td>
                <td className={td}>
                  <FollowUp on={request.followUpOn} closed={isClosed(request.stage)} />
                  {request.nextStep && !isClosed(request.stage) && (
                    <span className="text-ink-500 line-clamp-1 block max-w-52 text-xs">{request.nextStep}</span>
                  )}
                </td>
                <td className={td}>
                  <Manager person={request.owner} />
                </td>
                <td className={`${td} whitespace-nowrap`}>{daysOpen(request)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// --- Registering a new request --------------------------------------------------

/** The initial-interest form (doc §4.11): who asked, for what, and when to follow up. */
export function NewSalesRequestForm({ me, clientId: presetClientId }: { me: string; clientId?: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const clients = api.clients.list.useQuery();
  const events = api.event.list.useQuery();
  const people = api.user.list.useQuery();
  const [clientId, setClientId] = useState(presetClientId ?? "");
  const [newClient, setNewClient] = useState<string | null>(null);
  const [contactId, setContactId] = useState("");
  const [eventId, setEventId] = useState("");
  const [ownerId, setOwnerId] = useState(me);
  const [followUpOn, setFollowUpOn] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [interest, setInterest] = useState<Record<InterestKey, string>>(
    Object.fromEntries(interestFields.map((field) => [field.key, ""])) as Record<InterestKey, string>,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const client = api.clients.byId.useQuery({ id: clientId }, { enabled: Boolean(clientId) });

  const create = api.sales.create.useMutation({
    onSuccess: (request) => {
      void utils.sales.invalidate();
      void utils.clients.invalidate();
      router.push(`/sales/${request.id}`);
    },
  });

  const submit = () => {
    setProblem(null);
    if (!clientId && !newClient?.trim()) {
      setProblem("Choose the client, or add a new one.");
      return;
    }
    create.mutate({
      ...(newClient !== null ? { newClientName: newClient } : { clientId }),
      contactId: newClient !== null ? null : contactId || null,
      eventId: eventId || null,
      ownerId: ownerId || null,
      followUpOn,
      nextStep,
      ...interest,
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Who is asking</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <span className="text-ink-700 mb-1.5 block text-[13px] font-medium">Client</span>
            {newClient === null ? (
              <>
                <Combobox
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id);
                    setContactId("");
                  }}
                  placeholder="Choose a client"
                  options={(clients.data ?? []).map((c) => ({ id: c.id, label: c.name, detail: c.shortName }))}
                />
                <button type="button" onClick={() => setNewClient("")} className="text-brand-700 mt-1 text-xs font-light hover:underline">
                  + A client we have not dealt with yet
                </button>
              </>
            ) : (
              <>
                <Input value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="The company's name" aria-label="New client" autoFocus />
                <button type="button" onClick={() => setNewClient(null)} className="text-brand-700 mt-1 text-xs font-light hover:underline">
                  Choose an existing client instead
                </button>
              </>
            )}
          </div>
          <Field label="Contact" hint={newClient !== null ? "Add their people on the client's page once it exists." : undefined}>
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={newClient !== null || !clientId}>
              <option value="">{clientId && (client.data?.contacts.length ?? 0) === 0 ? "No contacts recorded" : "Not chosen"}</option>
              {(client.data?.contacts ?? []).map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.title ? ` — ${contact.title}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Event">
            <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">Not one of our events</option>
              {(events.data ?? []).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account manager">
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Nobody yet</option>
              {(people.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? person.email}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-ink-900 mb-1 text-[15px] font-medium">Their initial interest</h2>
        <p className="text-ink-500 mb-3 text-xs font-light">As the client put it — fill in what you know; the rest can come later.</p>
        <InterestFields values={interest} onChange={(key, value) => setInterest((current) => ({ ...current, [key]: value }))} />
      </Card>

      <Card>
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Follow up</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Follow up on">
            <Input type="date" value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} />
          </Field>
          <Field label="Next step" className="sm:col-span-2">
            <Input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Look for units near the Expo, then send a proposal" />
          </Field>
        </div>
      </Card>

      <div className="space-y-2">
        <FormError message={problem ?? (create.error ? friendlyError(create.error) : null)} />
        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Registering…" : "Register sales request"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function InterestFields({ values, onChange }: { values: Record<InterestKey, string>; onChange: (key: InterestKey, value: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {interestFields.map((field) => (
        <Field key={field.key} label={field.label} className={field.key === "description" ? "sm:col-span-2" : ""}>
          <Textarea
            rows={field.key === "description" ? 4 : 2}
            value={values[field.key]}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
        </Field>
      ))}
    </div>
  );
}

// --- A request's own page -------------------------------------------------------

function useSaved() {
  const router = useRouter();
  const utils = api.useUtils();
  return () => {
    void utils.sales.invalidate();
    void utils.audit.invalidate();
    router.refresh();
  };
}

function EditableCard({
  title,
  children,
  editor,
}: {
  title: string;
  children: React.ReactNode;
  editor: (done: () => void) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">{title}</h2>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-light hover:underline">
            Edit
          </button>
        )}
      </div>
      {editing ? editor(() => setEditing(false)) : children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-500 w-36 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 break-words whitespace-pre-line">{value ?? "—"}</dd>
    </div>
  );
}

function SaveButtons({ pending, onCancel, error }: { pending: boolean; onCancel: () => void; error: string | null }) {
  return (
    <div className="mt-4 space-y-2">
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A text section — the interest, or the contracting details — shown as text and edited as boxes. */
function TextSection<K extends InterestKey | ContractingKey>({
  request,
  title,
  fields,
  empty,
}: {
  request: FullRequest;
  title: string;
  fields: readonly { key: K; label: string; placeholder?: string }[];
  empty: string;
}) {
  const saved = useSaved();
  const save = api.sales.update.useMutation();
  const filled = fields.filter((field) => request[field.key]);
  return (
    <EditableCard
      title={title}
      editor={(done) => (
        <TextEditor
          fields={fields}
          initial={Object.fromEntries(fields.map((field) => [field.key, request[field.key] ?? ""])) as Record<K, string>}
          pending={save.isPending}
          error={save.error ? friendlyError(save.error) : null}
          onCancel={done}
          onSave={(values) =>
            save.mutate({ id: request.id, ...values }, { onSuccess: () => { saved(); done(); } })
          }
        />
      )}
    >
      {filled.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">{empty}</p>
      ) : (
        <dl className="space-y-2 text-sm font-light">
          {filled.map((field) => (
            <Row key={field.key} label={field.label} value={request[field.key]} />
          ))}
        </dl>
      )}
    </EditableCard>
  );
}

function TextEditor<K extends string>({
  fields,
  initial,
  pending,
  error,
  onCancel,
  onSave,
}: {
  fields: readonly { key: K; label: string; placeholder?: string }[];
  initial: Record<K, string>;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (values: Record<K, string>) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} className={initial[field.key].length > 120 || field.key === "description" ? "sm:col-span-2" : ""}>
            <Textarea
              rows={field.key === "description" ? 6 : 2}
              value={values[field.key]}
              onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
            />
          </Field>
        ))}
      </div>
      <SaveButtons pending={pending} onCancel={onCancel} error={error} />
    </form>
  );
}

/** The stage, as buttons: open stages in order, then the ways it can close. */
function StagePicker({ request }: { request: FullRequest }) {
  const saved = useSaved();
  const setStage = api.sales.setStage.useMutation({ onSuccess: saved });
  const button = (stage: SalesRequestStage) => {
    const current = request.stage === stage;
    return (
      <button
        key={stage}
        type="button"
        title={salesStageHints[stage]}
        disabled={setStage.isPending}
        onClick={() => !current && setStage.mutate({ id: request.id, stage })}
        aria-pressed={current}
        className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
          current ? `${salesStageStyles[stage]} border-transparent font-medium` : "border-ink-200 text-ink-500 hover:text-ink-900 bg-white font-light"
        }`}
      >
        {salesStageLabels[stage]}
      </button>
    );
  };
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {openStages.map(button)}
        <span className="text-ink-300 px-1">|</span>
        <span className="text-ink-500 text-xs font-light">Closed as</span>
        {closedStages.map(button)}
      </div>
      <p className="text-ink-500 mt-2 text-xs font-light">{salesStageHints[request.stage]}</p>
      {setStage.error && <FormError message={friendlyError(setStage.error)} />}
    </Card>
  );
}

function FollowUpCard({ request }: { request: FullRequest }) {
  const saved = useSaved();
  const save = api.sales.update.useMutation();
  const closed = isClosed(request.stage);
  return (
    <EditableCard
      title="Follow up"
      editor={(done) => (
        <FollowUpEditor
          initial={{ followUpOn: dayInput(request.followUpOn), nextStep: request.nextStep ?? "" }}
          pending={save.isPending}
          error={save.error ? friendlyError(save.error) : null}
          onCancel={done}
          onSave={(values) => save.mutate({ id: request.id, ...values }, { onSuccess: () => { saved(); done(); } })}
        />
      )}
    >
      <dl className="space-y-2 text-sm font-light">
        <Row label="Follow up on" value={request.followUpOn ? <FollowUp on={request.followUpOn} closed={closed} /> : null} />
        <Row label="Next step" value={request.nextStep} />
      </dl>
    </EditableCard>
  );
}

function FollowUpEditor({
  initial,
  pending,
  error,
  onCancel,
  onSave,
}: {
  initial: { followUpOn: string; nextStep: string };
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (values: { followUpOn: string; nextStep: string }) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
      className="space-y-3"
    >
      <Field label="Follow up on">
        <Input type="date" value={values.followUpOn} onChange={(e) => setValues({ ...values, followUpOn: e.target.value })} />
      </Field>
      <Field label="Next step">
        <Textarea rows={2} value={values.nextStep} onChange={(e) => setValues({ ...values, nextStep: e.target.value })} placeholder="Call to see if they have decided" />
      </Field>
      <SaveButtons pending={pending} onCancel={onCancel} error={error} />
    </form>
  );
}

function DetailsCard({ request }: { request: FullRequest }) {
  const saved = useSaved();
  const save = api.sales.update.useMutation();
  const events = api.event.list.useQuery();
  const people = api.user.list.useQuery();
  return (
    <EditableCard
      title="Details"
      editor={(done) => (
        <DetailsEditor
          request={request}
          events={events.data ?? []}
          people={people.data ?? []}
          pending={save.isPending}
          error={save.error ? friendlyError(save.error) : null}
          onCancel={done}
          onSave={(values) => save.mutate({ id: request.id, ...values }, { onSuccess: () => { saved(); done(); } })}
        />
      )}
    >
      <dl className="space-y-2 text-sm font-light">
        <Row
          label="Client"
          value={
            <Link href={`/clients/${request.client.id}`} className="text-brand-700 hover:underline">
              {request.client.name}
            </Link>
          }
        />
        <Row label="Contact" value={request.contact ? [request.contact.name, request.contact.title].filter(Boolean).join(", ") : null} />
        <Row label="Event" value={request.event?.name} />
        <Row label="Account manager" value={request.owner ? <Manager person={request.owner} /> : null} />
        <Row label="Registered" value={formatDate(request.createdAt)} />
        <Row label="Proposal sent on" value={request.proposalSentOn ? formatDate(request.proposalSentOn) : null} />
        <Row label="Blocked until" value={request.blockedUntil ? formatDate(request.blockedUntil) : null} />
        <Row label="Value" value={request.valueCents !== null && request.valueCurrency ? formatMoney(request.valueCents, request.valueCurrency) : null} />
        {request.closedOn && <Row label="Closed on" value={formatDate(request.closedOn)} />}
        <Row label="Days open" value={String(daysOpen(request))} />
      </dl>
    </EditableCard>
  );
}

function DetailsEditor({
  request,
  events,
  people,
  pending,
  error,
  onCancel,
  onSave,
}: {
  request: FullRequest;
  events: { id: string; name: string }[];
  people: { id: string; name: string | null; email: string | null }[];
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (values: {
    contactId: string | null;
    eventId: string | null;
    ownerId: string | null;
    proposalSentOn: string;
    blockedUntil: string;
    valueCents: number | null;
    valueCurrency: string | null;
  }) => void;
}) {
  const [values, setValues] = useState({
    contactId: request.contact?.id ?? "",
    eventId: request.event?.id ?? "",
    ownerId: request.owner?.id ?? "",
    proposalSentOn: dayInput(request.proposalSentOn),
    blockedUntil: dayInput(request.blockedUntil),
    value: request.valueCents !== null ? (request.valueCents / 100).toFixed(2) : "",
    valueCurrency: request.valueCurrency ?? "EUR",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const amount = values.value.trim() ? Number(values.value.replace(/[’',\s]/g, "")) : null;
        if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
          setProblem("The value should be a number, like 250000.");
          return;
        }
        onSave({
          contactId: values.contactId || null,
          eventId: values.eventId || null,
          ownerId: values.ownerId || null,
          proposalSentOn: values.proposalSentOn,
          blockedUntil: values.blockedUntil,
          valueCents: amount === null ? null : Math.round(amount * 100),
          valueCurrency: amount === null ? null : values.valueCurrency,
        });
      }}
      className="space-y-3"
    >
      <Field label="Contact">
        <Select value={values.contactId} onChange={(e) => set("contactId")(e.target.value)}>
          <option value="">Not chosen</option>
          {request.client.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
              {contact.title ? ` — ${contact.title}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Event">
        <Select value={values.eventId} onChange={(e) => set("eventId")(e.target.value)}>
          <option value="">Not one of our events</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Account manager">
        <Select value={values.ownerId} onChange={(e) => set("ownerId")(e.target.value)}>
          <option value="">Nobody yet</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name ?? person.email}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Proposal sent on">
          <Input type="date" value={values.proposalSentOn} onChange={(e) => set("proposalSentOn")(e.target.value)} />
        </Field>
        <Field label="Blocked until">
          <Input type="date" value={values.blockedUntil} onChange={(e) => set("blockedUntil")(e.target.value)} />
        </Field>
      </div>
      <Field label="Value" hint="What the request is worth to us if it is signed.">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input value={values.value} onChange={(e) => set("value")(e.target.value)} inputMode="decimal" placeholder="250000" aria-label="Value" />
          </div>
          <div className="w-24 shrink-0">
            <Select value={values.valueCurrency} onChange={(e) => set("valueCurrency")(e.target.value)} aria-label="Currency">
              {CURRENCIES.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </Select>
          </div>
        </div>
      </Field>
      <SaveButtons pending={pending} onCancel={onCancel} error={problem ?? error} />
    </form>
  );
}

export function SalesRequestView({ request }: { request: FullRequest }) {
  return (
    <div className="space-y-5">
      <StagePicker request={request} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <TextSection request={request} title="Initial interest" fields={interestFields} empty="Nothing recorded yet — Edit to add what the client asked for." />
          <TextSection
            request={request}
            title="Contracting details"
            fields={contractingFields}
            empty="None yet. These are what the lawyers need to draw up the contract — the client's legal name, address, VAT and registration numbers, and who signs."
          />
        </div>
        <div className="space-y-5">
          <FollowUpCard request={request} />
          <DetailsCard request={request} />
        </div>
      </div>
    </div>
  );
}

/** A client's sales requests, on the client's own page. */
export function ClientSalesRequests({ clientId }: { clientId: string }) {
  const requests = api.sales.forClient.useQuery({ clientId });
  const rows = requests.data ?? [];
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Sales requests</h2>
        <Link href={`/sales/new?client=${clientId}`} className="text-brand-700 text-[13px] font-light hover:underline">
          + New sales request
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">{requests.isLoading ? "…" : "None yet."}</p>
      ) : (
        <ul className="divide-ink-200/60 divide-y">
          {rows.map((request) => (
            <li key={request.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link href={`/sales/${request.id}`} className="hover:text-brand-700 text-sm font-medium">
                  {request.event?.name ?? "No event"}
                  {request.contact ? ` · ${request.contact.name}` : ""}
                </Link>
                <span className="text-ink-500 line-clamp-1 block text-xs font-light">{request.description ?? request.rooms ?? "—"}</span>
              </div>
              <StageBadge stage={request.stage} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

"use client";

import { keepPreviousData } from "@tanstack/react-query";
import type { SalesRequestStage } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Manager } from "~/app/_components/client-list";
import { contractHref, newContractHref } from "~/lib/finance";
import { periodProblem, RatePeriods, wholeStay, type RatePeriod } from "~/app/_components/rate-periods";
import { Combobox } from "~/app/_components/combobox";
import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Card, EmptyState } from "~/app/_components/ui";
import { addDays, daysUntil, dayKey, today } from "~/lib/dates";
import { formatDate, formatMoney, formatRange } from "~/lib/format";
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
              <th className={th} title="The client's room-nights on this event, from the inventory">Rooms</th>
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
                <td className={`${td} whitespace-nowrap`}>
                  {request.nightsSold || request.nightsBlocked ? (
                    <>
                      {request.nightsSold > 0 && <span className="block">{request.nightsSold} nights sold</span>}
                      {request.nightsBlocked > 0 && <span className="text-brand-800 block">{request.nightsBlocked} blocked</span>}
                    </>
                  ) : (
                    <span className="text-ink-500">—</span>
                  )}
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
  extra,
}: {
  request: FullRequest;
  title: string;
  fields: readonly { key: K; label: string; placeholder?: string }[];
  empty: string;
  /** Shown under the fields, and while editing too. */
  extra?: React.ReactNode;
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
      {extra}
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

/**
 * The private link for the client to fill in their own company details and
 * who signs (doc §4.11): made, copied and switched off here.
 */
function ContractingLink({ request }: { request: FullRequest }) {
  const saved = useSaved();
  const make = api.sales.makeContractingLink.useMutation({ onSuccess: saved });
  const off = api.sales.switchOffContractingLink.useMutation({ onSuccess: saved });
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = request.contractingToken ? `${origin}/contracting/${request.contractingToken}` : null;
  const error = make.error ?? off.error;

  return (
    <div className="border-ink-200/60 mt-4 border-t pt-4">
      <p className="text-ink-900 text-[13px] font-medium">Link for the client</p>
      {request.contractingSubmittedAt && (
        <p className="mt-1 text-xs font-light text-[#0a7a47]">
          The client sent their details {formatDate(request.contractingSubmittedAt)} — check them above.
        </p>
      )}
      {url ? (
        <>
          <p className="text-ink-500 mt-1 text-xs font-light">
            Send this to the client instead of the Word form. It asks only for their company details, who signs, and
            their contact persons — never our terms or notes — and what they send lands here.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="bg-ink-50 text-ink-700 max-w-full truncate rounded px-2 py-1 text-xs">{url}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="text-brand-700 text-xs font-medium hover:underline"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="text-brand-700 text-xs font-light hover:underline">
              Open ↗
            </a>
            <button
              type="button"
              disabled={off.isPending}
              onClick={() => off.mutate({ id: request.id })}
              className="text-xs font-light text-[#c03654] hover:underline"
            >
              Switch off
            </button>
          </div>
        </>
      ) : (
        <div className="mt-1">
          <p className="text-ink-500 text-xs font-light">
            A private web page where the client fills in their company details and who signs, instead of the Word form.
            No sign-in; anyone with the link can open it, so send it only to the client.
          </p>
          <button
            type="button"
            disabled={make.isPending}
            onClick={() => make.mutate({ id: request.id })}
            className="text-brand-700 mt-2 text-[13px] font-medium hover:underline"
          >
            {make.isPending ? "Making the link…" : request.contractingLinkMadeAt ? "Make a new link" : "Make a link"}
          </button>
        </div>
      )}
      {error && <FormError message={friendlyError(error)} />}
    </div>
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
        <Row label="Due date" value={request.blockedUntil ? formatDate(request.blockedUntil) : null} />
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
        <Field label="Due date">
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
          <RoomsCard request={request} />
          <TextSection
            request={request}
            title="Contracting details"
            fields={contractingFields}
            empty="None yet. These are what the lawyers need to draw up the contract — the client's legal name, address, VAT and registration numbers, and who signs."
            extra={<ContractingLink request={request} />}
          />
        </div>
        <div className="space-y-5">
          <FollowUpCard request={request} />
          <ContractCard request={request} />
          <DetailsCard request={request} />
        </div>
      </div>
    </div>
  );
}

const roomStateLabels = { SOLD: "Sold", BLOCKED: "Blocked", REQUESTED: "Requested", CANCELLED: "Cancelled" } as const;
const roomStateStyles = {
  SOLD: "bg-[#e3f8ee] text-[#0a7a47]",
  BLOCKED: "bg-brand-50 text-brand-800",
  REQUESTED: "bg-[#fff4e0] text-[#a15c00]",
  CANCELLED: "bg-ink-50 text-ink-500",
} as const;

type RoomRow = NonNullable<RouterOutputs["sales"]["rooms"]>["rows"][number];
type RoomAction = "BLOCK" | "SELL" | "WITHDRAW_REQUEST" | "EXTEND_BLOCK" | "RELEASE_HOLD" | "CANCEL_SALE";

/** What can be done to a row of a request's rooms, in the business's words. */
const rowActions: Record<RoomRow["state"], { action: RoomAction; label: string }[]> = {
  REQUESTED: [
    { action: "BLOCK", label: "Block" },
    { action: "SELL", label: "Sell" },
    { action: "WITHDRAW_REQUEST", label: "Withdraw" },
  ],
  BLOCKED: [
    { action: "SELL", label: "Sell" },
    { action: "EXTEND_BLOCK", label: "Extend" },
    { action: "RELEASE_HOLD", label: "Release" },
  ],
  SOLD: [{ action: "CANCEL_SALE", label: "Cancel sale" }],
  CANCELLED: [],
};

/** The stage a request has reached once its rooms are blocked or sold — offered, never made. */
const stageAfter = { BLOCK: "BLOCKED", SELL: "SIGNED" } as const;

/** Re-reads the rooms, and resolves once the table shows the change — so "done" is never said before it is. */
function useRoomsSaved() {
  const saved = useSaved();
  const utils = api.useUtils();
  return async () => {
    void utils.sales.availability.invalidate();
    void utils.inventory.invalidate();
    saved();
    await utils.sales.rooms.invalidate();
  };
}

/**
 * The rooms behind the request (doc §4.11): what is requested, blocked and
 * sold for it in the event's inventory — added and moved on from here, through
 * the inventory's own rules.
 */
function RoomsCard({ request }: { request: FullRequest }) {
  const rooms = api.sales.rooms.useQuery({ id: request.id });
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<{ text: string; offer: SalesRequestStage | null } | null>(null);
  const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
  const td = "border-ink-200/40 border-b px-3 py-2 align-top text-[13px] font-light";
  const data = rooms.data;

  const finished = (text: string, action: RoomAction | "REQUEST") => {
    const next = action === "BLOCK" || action === "SELL" ? stageAfter[action] : null;
    const ahead = next && salesStageOrder.indexOf(next) > salesStageOrder.indexOf(request.stage) && !isClosed(request.stage);
    setDone({ text, offer: ahead ? next : null });
  };

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Rooms</h2>
        <div className="flex items-baseline gap-4">
          {data && !adding && (
            <button type="button" onClick={() => { setAdding(true); setDone(null); }} className="text-brand-700 text-[13px] font-medium hover:underline">
              + Add rooms
            </button>
          )}
          {data && (
            <Link href={`/events/${data.eventId}/inventory`} className="text-brand-700 text-[13px] font-light hover:underline">
              Inventory
            </Link>
          )}
        </div>
      </div>

      {done && <Done done={done} request={request} onClose={() => setDone(null)} />}

      {adding && data && (
        <AddRooms
          request={request}
          onCancel={() => setAdding(false)}
          onDone={(text, action) => {
            setAdding(false);
            finished(text, action);
          }}
        />
      )}

      {rooms.isLoading ? (
        <p className="text-ink-500 text-sm font-light">…</p>
      ) : data === null ? (
        <p className="text-ink-500 text-sm font-light">Choose the event under Details to request, block or sell rooms for this request.</p>
      ) : !data ? null : (
        <>
          {data.rows.length === 0 ? (
            !adding && (
              <p className="text-ink-500 text-sm font-light">
                No rooms on this request yet. <strong className="font-medium">+ Add rooms</strong> requests, blocks or sells them in
                the event&apos;s inventory, straight from here.
              </p>
            )
          ) : (
            <div className="border-ink-200/60 overflow-x-auto rounded-lg border">
              <table className="w-full text-left">
                <thead className="bg-ink-50/60">
                  <tr>
                    <th className={th}>Where</th>
                    <th className={th}>Status</th>
                    <th className={th}>Rooms</th>
                    <th className={th}>Stay</th>
                    <th className={th}>Price</th>
                    <th className={th}>{""}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <RoomRowView key={`${row.categoryId}-${row.state}`} row={row} request={request} td={td} onDone={finished} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.loose > 0 && <LooseRooms request={request} count={data.loose} />}
        </>
      )}
    </Card>
  );
}

function Done({ done, request, onClose }: { done: { text: string; offer: SalesRequestStage | null }; request: FullRequest; onClose: () => void }) {
  const saved = useSaved();
  const setStage = api.sales.setStage.useMutation({ onSuccess: () => { saved(); onClose(); } });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-[#e3f8ee] px-3 py-2 text-[13px] text-[#0a7a47]">
      <span>{done.text}</span>
      {done.offer && (
        <button
          type="button"
          disabled={setStage.isPending}
          onClick={() => setStage.mutate({ id: request.id, stage: done.offer! })}
          className="font-medium hover:underline"
        >
          Mark the request {salesStageLabels[done.offer]}
        </button>
      )}
      <button type="button" onClick={onClose} className="ml-auto text-xs font-light hover:underline">
        Close
      </button>
    </div>
  );
}

function RoomRowView({
  row,
  request,
  td,
  onDone,
}: {
  row: RoomRow;
  request: FullRequest;
  td: string;
  onDone: (text: string, action: RoomAction) => void;
}) {
  const [acting, setActing] = useState<RoomAction | null>(null);
  const price = row.price ? `${formatMoney(row.price.cents, row.price.currency)} / night` : row.state === "CANCELLED" ? "—" : "Not priced";
  return (
    <>
      <tr>
        <td className={`${td} text-ink-900`}>
          <Link href={`/properties/${row.propertyId}`} className="hover:text-brand-700">
            {row.propertyName}
          </Link>
          <span className="text-ink-500 block text-xs">{row.categoryName}</span>
        </td>
        <td className={td}>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${roomStateStyles[row.state]}`}>{roomStateLabels[row.state]}</span>
          {row.blockExpiry && <span className="text-ink-500 mt-1 block text-xs whitespace-nowrap">due {formatDate(row.blockExpiry)}</span>}
        </td>
        <td className={`${td} whitespace-nowrap`}>
          {row.rooms}
          <span className="text-ink-500 block text-xs">{row.nights} room-nights</span>
        </td>
        <td className={`${td} whitespace-nowrap`}>{row.from.getTime() === row.to.getTime() ? formatDate(row.from) : formatRange(row.from, addDays(row.to, 1))}</td>
        <td className={`${td} whitespace-nowrap`}>
          {price}
          {row.value && row.state !== "REQUESTED" && (
            <span className="text-ink-500 block text-xs">{formatMoney(row.value.cents, row.value.currency)} in all</span>
          )}
        </td>
        <td className={`${td} whitespace-nowrap`}>
          {rowActions[row.state].map((option) => (
            <button
              key={option.action}
              type="button"
              onClick={() => setActing(acting === option.action ? null : option.action)}
              className={`mr-3 text-xs hover:underline ${option.action === "RELEASE_HOLD" || option.action === "CANCEL_SALE" || option.action === "WITHDRAW_REQUEST" ? "text-[#c03654]" : "text-brand-700 font-medium"}`}
            >
              {option.label}
            </button>
          ))}
        </td>
      </tr>
      {acting && (
        <tr>
          <td colSpan={6} className="border-ink-200/40 bg-brand-50/40 border-b p-3">
            <ChangeRooms
              row={row}
              request={request}
              action={acting}
              onCancel={() => setActing(null)}
              onDone={(text) => {
                setActing(null);
                onDone(text, acting);
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** The small form for moving a row of rooms on: a price for a sale, a date for a block. */
function ChangeRooms({
  row,
  request,
  action,
  onCancel,
  onDone,
}: {
  row: RoomRow;
  request: FullRequest;
  action: RoomAction;
  onCancel: () => void;
  onDone: (text: string) => void;
}) {
  const refresh = useRoomsSaved();
  const [blockExpiry, setBlockExpiry] = useState(row.blockExpiry ? dayKey(row.blockExpiry) : "");
  const [price, setPrice] = useState(row.price ? (row.price.cents / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(row.price?.currency ?? "USD");
  const [problem, setProblem] = useState<string | null>(null);
  const change = api.sales.changeRooms.useMutation({
    onSuccess: async (outcome) => {
      await refresh();
      onDone(`${changeWords[action]} — ${outcome.nights} room-nights of ${row.categoryName}, ${row.propertyName}.`);
    },
  });
  const needsPrice = action === "SELL" || action === "BLOCK";
  const [contractId, setContractId] = useState("");
  const needsDate = action === "BLOCK" || action === "EXTEND_BLOCK";
  const warning = {
    RELEASE_HOLD: `Releases the client's block on these ${row.nights} room-nights. They become free for anyone.`,
    CANCEL_SALE: `Cancels the sale of these ${row.nights} room-nights. They stay on record as cancelled and stop counting as sold.`,
    WITHDRAW_REQUEST: `Withdraws the client's request for these ${row.nights} room-nights.`,
  } as Partial<Record<RoomAction, string>>;

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        const amount = price.trim() ? Number(price.replace(",", ".")) : null;
        if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
          setProblem("The price should be a number, like 281.50.");
          return;
        }
        if (needsPrice && amount === null) {
          setProblem(`Give the price per night — rooms ${action === "BLOCK" ? "blocked" : "sold"} for a client need their agreed price.`);
          return;
        }
        if (action === "SELL" && !contractId) {
          setProblem("Choose the client contract these rooms are sold under.");
          return;
        }
        change.mutate({
          ...(action === "SELL" && { salesContractId: contractId }),
          id: request.id,
          categoryId: row.categoryId,
          state: row.state as "REQUESTED" | "BLOCKED" | "SOLD",
          action,
          blockExpiry: needsDate ? blockExpiry : undefined,
          ...(needsPrice && { sellPriceCents: amount === null ? null : Math.round(amount * 100), sellCurrency: currency }),
        });
      }}
    >
      {warning[action] && <p className="text-ink-700 w-full text-[13px] font-light">{warning[action]}</p>}
      {action === "SELL" && <RequestContractPicker request={request} value={contractId} onChange={setContractId} />}
      {needsDate && (
        <div className="w-44">
          <Field label={action === "EXTEND_BLOCK" ? "New due date" : "Due date"}>
            <Input type="date" value={blockExpiry} onChange={(e) => setBlockExpiry(e.target.value)} required />
          </Field>
        </div>
      )}
      {needsPrice && (
        <div className="w-64">
          <Field label="Price per night — required">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="350.00" aria-label="Price per night" />
              </div>
              <div className="w-24 shrink-0">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                  {["USD", "EUR", "CHF", "GBP"].map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </Select>
              </div>
            </div>
          </Field>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={change.isPending}>
          {change.isPending ? "Working…" : confirmWords[action]}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {(problem ?? change.error) && (
        <p className="w-full text-xs whitespace-pre-line text-[#c03654]">{problem ?? friendlyError(change.error)}</p>
      )}
    </form>
  );
}

const changeWords: Record<RoomAction, string> = {
  BLOCK: "Blocked",
  SELL: "Sold",
  WITHDRAW_REQUEST: "Request withdrawn",
  EXTEND_BLOCK: "Block extended",
  RELEASE_HOLD: "Block released",
  CANCEL_SALE: "Sale cancelled",
};
const confirmWords: Record<RoomAction, string> = {
  BLOCK: "Block these rooms",
  SELL: "Sell these rooms",
  WITHDRAW_REQUEST: "Withdraw the request",
  EXTEND_BLOCK: "Extend the block",
  RELEASE_HOLD: "Release the block",
  CANCEL_SALE: "Cancel the sale",
};

/**
 * Request, block or sell rooms for this request: a room category, how many,
 * which nights. The rooms themselves are chosen by the system — free for the
 * whole stay, bought ones first.
 */
function AddRooms({
  request,
  onCancel,
  onDone,
}: {
  request: FullRequest;
  onCancel: () => void;
  onDone: (text: string, action: "REQUEST" | "BLOCK" | "SELL") => void;
}) {
  const refresh = useRoomsSaved();
  const options = api.sales.roomOptions.useQuery({ id: request.id });
  const [categoryId, setCategoryId] = useState("");
  const [count, setCount] = useState("1");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [action, setAction] = useState<"REQUEST" | "BLOCK" | "SELL">("BLOCK");
  const [blockExpiry, setBlockExpiry] = useState(request.blockedUntil ? dayKey(request.blockedUntil) : "");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [clientRef, setClientRef] = useState("");
  const [contractId, setContractId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // A pre rate, the event rate, a post rate (doc §4.8) — in place of the one price.
  const [periodsMode, setPeriodsMode] = useState(false);
  const [periods, setPeriods] = useState<RatePeriod[]>([]);
  useEffect(() => {
    setPeriods((current) =>
      current.length
        ? current.map((period, i) => ({
            ...period,
            ...(i === 0 && { checkIn }),
            ...(i === current.length - 1 && { checkOut }),
          }))
        : current,
    );
  }, [checkIn, checkOut]);

  const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut) && checkOut > checkIn;
  const availability = api.sales.availability.useQuery(
    { id: request.id, categoryId, checkIn, checkOut },
    { enabled: Boolean(categoryId) && datesOk },
  );
  const add = api.sales.addRooms.useMutation({
    onSuccess: async (outcome) => {
      await refresh();
      const label = options.data?.find((option) => option.id === categoryId)?.label ?? "";
      onDone(
        `${addWords[action]} ${outcome.rooms} ${outcome.rooms === 1 ? "room" : "rooms"} (#${outcome.slotNumbers.join(", #")}) — ${outcome.nights} room-nights, ${label}.`,
        action,
      );
    },
  });
  const wanted = Number(count);
  const free = availability.data?.free;

  return (
    <form
      className="border-ink-200/60 bg-ink-50/40 mb-4 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        if (!categoryId) return setProblem("Choose the room category.");
        if (!Number.isInteger(wanted) || wanted < 1) return setProblem("Say how many rooms, like 6.");
        if (!datesOk) return setProblem("Give a check-in and a check-out after it.");
        if (action === "BLOCK" && !blockExpiry) return setProblem("Give the client's due date — a block needs one.");
        if (periodsMode) {
          const wrong = periodProblem(periods, checkIn, checkOut);
          if (wrong) return setProblem(wrong);
        } else if (action !== "REQUEST" && !price.trim()) {
          return setProblem(`Give the price per night — rooms ${action === "BLOCK" ? "blocked" : "sold"} for a client need their agreed price.`);
        }
        const amount = price.trim() ? Number(price.replace(",", ".")) : null;
        if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return setProblem("The price should be a number, like 281.50.");
        if (action === "SELL" && !contractId) return setProblem("Choose the client contract these rooms are sold under.");
        add.mutate({
          ...(action === "SELL" && { salesContractId: contractId }),
          ...(periodsMode && {
            periods: periods.map((period) => ({
              checkIn: period.checkIn,
              checkOut: period.checkOut,
              priceCents: Math.round(Number(period.price.replace(",", ".")) * 100),
              currency,
            })),
          }),
          id: request.id,
          categoryId,
          rooms: wanted,
          checkIn,
          checkOut,
          action,
          blockExpiry: action === "BLOCK" ? blockExpiry : undefined,
          sellPriceCents: amount === null ? null : Math.round(amount * 100),
          sellCurrency: currency,
          clientRef,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Room category" className="sm:col-span-3">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{options.data?.length === 0 ? "Nothing in this event's inventory yet" : "Choose…"}</option>
            {(options.data ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rooms" className="sm:col-span-1">
          <Input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" aria-label="Rooms" />
        </Field>
        <Field label="Check-in" className="sm:col-span-1">
          <Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </Field>
        <Field label="Check-out" className="sm:col-span-1">
          <Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </Field>
      </div>

      {categoryId && datesOk && availability.data && (
        <p className={`mt-2 text-[13px] font-light ${free !== undefined && free < wanted ? "text-[#c03654]" : "text-ink-700"}`}>
          {availability.data.free} of {availability.data.total} rooms are free for every night of the stay
          {availability.data.free > 0 && ` — ${availability.data.freeBought} of them bought`}.
          {availability.data.alreadyTheirs > 0 && ` ${availability.data.alreadyTheirs} are already this client's on some of those nights.`}
          {availability.data.notInInventory > 0 && ` ${availability.data.notInInventory} are not in inventory for all those dates.`}
          {free !== undefined && free >= wanted && availability.data.freeBought < wanted && action !== "REQUEST" && (
            <span className="block text-[#a15c00]">
              Fewer than {wanted} are bought: {action === "SELL" ? "selling" : "blocking"} them sells ahead of what we hold, and makes us short.
            </span>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-700 text-[13px] font-medium">Do</span>
        {(["REQUEST", "BLOCK", "SELL"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setAction(option)}
            aria-pressed={action === option}
            title={addHints[option]}
            className={`rounded-full border px-3 py-1 text-[12px] ${
              action === option ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500 bg-white font-light"
            }`}
          >
            {addLabels[option]}
          </button>
        ))}
        <span className="text-ink-500 text-xs font-light">{addHints[action]}</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-6">
        {action === "BLOCK" && (
          <Field label="Due date" className="sm:col-span-2">
            <Input type="date" value={blockExpiry} onChange={(e) => setBlockExpiry(e.target.value)} />
          </Field>
        )}
        {periodsMode ? (
          <div className="sm:col-span-6">
            <span className="text-ink-700 mb-1.5 block text-[13px] font-medium">Price per night, by period</span>
            <RatePeriods periods={periods} onChange={setPeriods} currency={currency} onCurrencyChange={setCurrency} />
          </div>
        ) : (
          <Field label={action === "REQUEST" ? "Price per night, to the client" : "Price per night — required"} className="sm:col-span-2">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="350.00" aria-label="Price per night" />
              </div>
              <div className="w-24 shrink-0">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                  {["USD", "EUR", "CHF", "GBP"].map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </Select>
              </div>
            </div>
          </Field>
        )}
        <Field label="Client reference" className="sm:col-span-2">
          <Input value={clientRef} onChange={(e) => setClientRef(e.target.value)} placeholder="Their order number" />
        </Field>
        {action === "SELL" && (
          <div className="sm:col-span-6">
            <RequestContractPicker request={request} value={contractId} onChange={setContractId} />
          </div>
        )}
      </div>
      {datesOk && (
        <button
          type="button"
          onClick={() => {
            if (!periodsMode) setPeriods(wholeStay(checkIn, checkOut, price));
            setPeriodsMode(!periodsMode);
          }}
          className="text-brand-700 mt-2 text-xs font-medium hover:underline"
        >
          {periodsMode ? "One rate for the whole stay" : "Different rates for different dates — pre, event, post"}
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Working…" : `${addLabels[action]} ${Number.isInteger(wanted) && wanted > 0 ? wanted : ""} ${wanted === 1 ? "room" : "rooms"}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {(problem ?? add.error) && <p className="mt-2 text-xs whitespace-pre-line text-[#c03654]">{problem ?? friendlyError(add.error)}</p>}
    </form>
  );
}

const addLabels = { REQUEST: "Request", BLOCK: "Block", SELL: "Sell" } as const;
const addWords = { REQUEST: "Requested", BLOCK: "Blocked", SELL: "Sold" } as const;
const addHints = {
  REQUEST: "A soft claim — locks nothing; other clients may ask for the same nights.",
  BLOCK: "Holds the rooms for the client until the date you give.",
  SELL: "The client has signed for these rooms.",
} as const;

/** The client's rooms on this event that belong to no request yet — made on the stock sheet, say. */
function LooseRooms({ request, count }: { request: FullRequest; count: number }) {
  const refresh = useRoomsSaved();
  const tie = api.sales.tieLooseRooms.useMutation({ onSuccess: () => refresh() });
  return (
    <p className="bg-ink-50 text-ink-700 mt-3 rounded-lg px-3 py-2 text-[13px] font-light">
      {request.client.name} has {count} more room-night{count === 1 ? "" : "s"} on {request.event?.name} that belong to no request —
      blocked, sold or requested on the stock sheet.{" "}
      <button type="button" disabled={tie.isPending} onClick={() => tie.mutate({ id: request.id })} className="text-brand-700 font-medium hover:underline">
        {tie.isPending ? "Tying…" : "Tie them to this request"}
      </button>
      {tie.error && <span className="block text-xs text-[#c03654]">{friendlyError(tie.error)}</span>}
    </p>
  );
}

/**
 * Which client contract a sale from the request is made under (doc §7.1): this
 * client's, for this event. Picked for you when there is just one; when there
 * is none, it says where to add it.
 */
function RequestContractPicker({ request, value, onChange }: { request: FullRequest; value: string; onChange: (id: string) => void }) {
  const contracts = api.finance.contracts.useQuery({ eventId: request.event?.id, party: "CLIENT" }, { enabled: Boolean(request.event) });
  const options = (contracts.data ?? []).filter((contract) => contract.clientId === request.client.id);
  useEffect(() => {
    if (!value && options.length === 1) onChange(options[0]!.id);
  }, [value, options, onChange]);
  if (contracts.isSuccess && options.length === 0) {
    return (
      <p className="w-full text-[13px] font-light text-[#c03654]">
        A sale needs the client&apos;s contract, and {request.client.name} has none for {request.event?.name} yet.{" "}
        <Link href={newContractHref(request.event?.id ?? "", `?request=${request.id}`)} className="text-brand-700 font-medium hover:underline">
          Add the contract
        </Link>
      </p>
    );
  }
  return (
    <div className="w-72">
      <Field label="Client contract — required">
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.name}
              {contract.missing.length ? " — terms missing" : ""}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** The signed contract with the client for this request, with its terms (doc §7.1). */
function ContractCard({ request }: { request: FullRequest }) {
  const contracts = api.finance.contracts.useQuery({ salesRequestId: request.id });
  const rows = contracts.data ?? [];
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Contract</h2>
        {request.event && (
          <Link href={newContractHref(request.event?.id ?? "", `?request=${request.id}`)} className="text-brand-700 text-[13px] font-light hover:underline">
            + New contract
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">
          {request.event
            ? "None yet. Once the client signs, add the contract with its payment and cancellation terms."
            : "Choose the event under Details first — a contract is for an event."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((contract) => (
            <li key={contract.id} className="text-sm">
              <Link href={contractHref(contract.event.id, contract.id)} className="hover:text-brand-700 font-medium">
                {contract.name}
              </Link>
              <span className={`block text-xs font-light ${contract.missing.length ? "text-[#c03654]" : "text-ink-500"}`}>
                {contract.missing.length
                  ? `Missing ${contract.missing.join(", ")}`
                  : `${contract._count.payments} payments · ${contract.totalCents !== null && contract.currency ? formatMoney(contract.totalCents, contract.currency) : ""}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
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

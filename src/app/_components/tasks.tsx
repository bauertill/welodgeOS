"use client";

import { keepPreviousData } from "@tanstack/react-query";
import type { Priority, TaskStatus } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Button, Field, FormError, friendlyError, Input, Label, Select, Textarea } from "~/app/_components/form";
import { MentionTextarea } from "~/app/_components/mention-textarea";
import { SourcingPanel } from "~/app/_components/sourcing-panel";
import { Initials } from "~/app/_components/property-groups";
import { EmptyState } from "~/app/_components/ui";
import { daysUntil, dayKey, nightsBetween } from "~/lib/dates";
import { priorityLabels, priorityOrder } from "~/lib/clients";
import { formatDate, formatDay, formatMomentInWords, formatMoney, formatRange } from "~/lib/format";
import { taskStatusHints, taskStatusLabels, taskStatusOrder, taskStatusStyles } from "~/lib/tasks";
import { renderUpdateBody } from "~/lib/updates";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * Tasks (doc §2.8): one board everyone sees, as a list or as Kanban columns
 * by status, with filters; each person's own on their profile as My work.
 */

type Task = RouterOutputs["task"]["list"][number];
type Person = { id: string; name: string | null; email: string | null; image?: string | null };

const priorityStyles: Record<Priority, string> = {
  HIGH: "bg-[#fde8ec] text-[#a3243d]",
  MEDIUM: "bg-[#fff4e0] text-[#8a5a00]",
  LOW: "bg-ink-50 text-ink-500",
};
const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
const td = "border-ink-200/40 border-b px-3 py-2.5 align-top text-[13px] font-light";
const firstName = (person: Person) => (person.name ?? person.email ?? "").split(" ")[0];

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span title={taskStatusHints[status]} className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${taskStatusStyles[status]}`}>
      {taskStatusLabels[status]}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityStyles[priority]}`}>{priorityLabels[priority]}</span>;
}

/** "Due 12 Oct", in red once it has passed and the task is still open. */
function Deadline({ task }: { task: Pick<Task, "deadline" | "status"> }) {
  if (!task.deadline) return <span className="text-ink-400">—</span>;
  const late = task.status !== "DONE" && daysUntil(task.deadline) < 0;
  const soon = task.status !== "DONE" && !late && daysUntil(task.deadline) <= 2;
  return (
    <span className={`whitespace-nowrap ${late ? "font-medium text-[#c03654]" : soon ? "text-[#8a5a00]" : ""}`}>
      {late ? "Overdue · " : ""}
      {formatDate(task.deadline)}
    </span>
  );
}

/** What the task is about, as links. */
function About({ task }: { task: Task }) {
  const items = [
    task.event && { href: `/events/${task.event.id}`, label: task.event.name },
    task.property && { href: `/properties/${task.property.id}`, label: task.property.name },
    task.salesRequest
      ? { href: `/sales/${task.salesRequest.id}`, label: `${task.salesRequest.client.name} · request` }
      : task.client && { href: `/clients/${task.client.id}`, label: task.client.shortName ?? task.client.name },
  ].filter(Boolean) as { href: string; label: string }[];
  if (items.length === 0) return null;
  return (
    <span className="text-ink-500 text-xs font-light">
      {items.map((item, index) => (
        <span key={item.href}>
          {index > 0 && " · "}
          <Link href={item.href} className="hover:text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            {item.label}
          </Link>
        </span>
      ))}
    </span>
  );
}

function Assignees({ people }: { people: Person[] }) {
  if (people.length === 0) return <span className="text-ink-400 text-xs">Nobody yet</span>;
  return (
    <span className="flex -space-x-1.5">
      {people.slice(0, 4).map((person) => (
        <Initials key={person.id} person={person} />
      ))}
      {people.length > 4 && <span className="text-ink-500 pl-2.5 text-xs">+{people.length - 4}</span>}
    </span>
  );
}

// --- The board ---------------------------------------------------------------

type Filters = {
  search: string;
  assigneeId: string;
  requestedById: string;
  priority: Priority | "";
  typeId: string;
  eventId: string;
  clientId: string;
};
const noFilters: Filters = { search: "", assigneeId: "", requestedById: "", priority: "", typeId: "", eventId: "", clientId: "" };

const viewKey = "welodge.tasks.view";

export function TaskBoard() {
  const [view, setView] = useState<"board" | "list">("board");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(viewKey);
      if (saved === "list" || saved === "board") setView(saved);
    } catch {}
  }, []);
  const chooseView = (next: "board" | "list") => {
    setView(next);
    try {
      localStorage.setItem(viewKey, next);
    } catch {}
  };

  const me = api.user.me.useQuery();
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => ({ ...current, search })), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  const tasks = api.task.list.useQuery(
    {
      search: filters.search || undefined,
      assigneeId: filters.assigneeId || undefined,
      requestedById: filters.requestedById || undefined,
      priority: filters.priority || undefined,
      typeId: filters.typeId || undefined,
      eventId: filters.eventId || undefined,
      clientId: filters.clientId || undefined,
      status: view === "list" && status ? status : undefined,
      // On the board, Done shows the last month; the list shows everything.
      doneWithinDays: view === "board" ? 30 : undefined,
    },
    { placeholderData: keepPreviousData },
  );
  const people = api.user.list.useQuery();
  const types = api.task.types.useQuery();
  const events = api.event.list.useQuery();
  const clients = api.clients.list.useQuery();

  const rows = tasks.data ?? [];
  const mine = me.data && filters.assigneeId === me.data.id;
  const filtered = Object.entries(filters).some(([key, value]) => key !== "search" && value) || Boolean(filters.search) || (view === "list" && status);
  const peopleOptions = (people.data ?? []).map((person) => ({ id: person.id, label: person.name ?? person.email ?? "" }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="border-ink-200 flex rounded-full border bg-white p-1">
          {(["board", "list"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => chooseView(option)}
              aria-pressed={view === option}
              className={`rounded-full px-4 py-1.5 text-[13px] font-light transition-colors ${view === option ? "bg-brand-400 text-white" : "text-ink-500 hover:text-ink-900"}`}
            >
              {option === "board" ? "Kanban" : "List"}
            </button>
          ))}
        </div>
        {me.data && (
          <button
            type="button"
            onClick={() => set("assigneeId", mine ? "" : me.data!.id)}
            aria-pressed={Boolean(mine)}
            className={`rounded-full px-4 py-2 text-[13px] font-light transition-colors ${
              mine ? "bg-brand-700 text-white" : "border-ink-200 text-ink-500 hover:border-brand-400 border bg-white"
            }`}
          >
            My tasks
          </button>
        )}
        <div className="w-56">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
        </div>
        <Link href="/tasks/new" className="bg-brand-400 hover:bg-brand-500 ml-auto rounded-full px-5 py-2.5 text-[13px] font-medium text-white">
          + New task
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Combobox className="w-44" value={filters.assigneeId} onChange={(value) => set("assigneeId", value)} placeholder="Anyone to complete" options={peopleOptions} />
        <Combobox className="w-44" value={filters.requestedById} onChange={(value) => set("requestedById", value)} placeholder="Requested by anyone" options={peopleOptions} />
        <div className="w-36">
        <Select value={filters.priority} onChange={(e) => set("priority", e.target.value as Priority | "")} aria-label="Priority">
          <option value="">Any priority</option>
          {priorityOrder.map((priority) => (
            <option key={priority} value={priority}>
              {priorityLabels[priority]}
            </option>
          ))}
        </Select>
        </div>
        {(types.data ?? []).length > 0 && (
          <div className="w-40">
          <Select value={filters.typeId} onChange={(e) => set("typeId", e.target.value)} aria-label="Type">
            <option value="">Every type</option>
            {(types.data ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
          </div>
        )}
        <Combobox
          className="w-48"
          value={filters.eventId}
          onChange={(value) => set("eventId", value)}
          placeholder="Every event"
          options={(events.data ?? []).map((event) => ({ id: event.id, label: event.name }))}
        />
        <Combobox
          className="w-48"
          value={filters.clientId}
          onChange={(value) => set("clientId", value)}
          placeholder="Every client"
          options={(clients.data ?? []).map((client) => ({ id: client.id, label: client.name, detail: client.shortName }))}
        />
        {view === "list" && (
          <div className="w-36">
          <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | "")} aria-label="Status">
            <option value="">Any status</option>
            {taskStatusOrder.map((option) => (
              <option key={option} value={option}>
                {taskStatusLabels[option]}
              </option>
            ))}
          </Select>
          </div>
        )}
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setFilters(noFilters);
              setSearch("");
              setStatus("");
            }}
            className="text-brand-700 text-[13px] font-light hover:underline"
          >
            Clear
          </button>
        )}
        <span className="text-ink-500 ml-auto text-[13px] font-light">
          {tasks.isLoading ? "Loading…" : `${rows.length} ${rows.length === 1 ? "task" : "tasks"}`}
        </span>
      </div>

      {rows.length === 0 && !tasks.isLoading ? (
        <EmptyState
          title={filtered ? "No task matches" : "No tasks yet"}
          description={filtered ? "Nothing matches these filters." : "Add the first with + New task — say who completes it, and by when."}
        />
      ) : view === "board" ? (
        <Kanban tasks={rows} />
      ) : (
        <TaskTable tasks={rows} />
      )}
    </div>
  );
}

/** Four columns by status; a card is dragged from one to another to move it. */
function Kanban({ tasks }: { tasks: Task[] }) {
  const utils = api.useUtils();
  const move = api.task.update.useMutation({
    onSettled: () => {
      void utils.task.invalidate();
      void utils.audit.invalidate();
    },
  });
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Shown in its new column at once, while the move is saved.
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  useEffect(() => setMoved({}), [tasks]);
  const statusOf = (task: Task) => moved[task.id] ?? task.status;

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {taskStatusOrder.map((column) => {
        const inColumn = tasks.filter((task) => statusOf(task) === column);
        return (
          <div
            key={column}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(column);
            }}
            onDragLeave={() => setOver((current) => (current === column ? null : current))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/task");
              const task = tasks.find((t) => t.id === id);
              if (task && statusOf(task) !== column) {
                setMoved((current) => ({ ...current, [id]: column }));
                move.mutate({ id, status: column });
              }
            }}
            className={`min-h-48 rounded-xl border p-2 transition-colors ${over === column ? "border-brand-400 bg-brand-50/60" : "border-ink-200/60 bg-ink-50/40"}`}
          >
            <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
              <TaskStatusBadge status={column} />
              <span className="text-ink-500 text-xs font-light">{inColumn.length}</span>
            </div>
            <div className="space-y-2">
              {inColumn.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  faded={dragging === task.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/task", task.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(task.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                />
              ))}
              {inColumn.length === 0 && <p className="text-ink-400 px-1.5 py-3 text-xs font-light">Nothing here.</p>}
            </div>
          </div>
        );
      })}
      {move.error && (
        <div className="lg:col-span-4">
          <FormError message={friendlyError(move.error)} />
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  faded,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  faded: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const router = useRouter();
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => router.push(`/tasks/${task.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/tasks/${task.id}`)}
      className={`border-ink-200/60 hover:border-brand-300 cursor-pointer rounded-lg border bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition ${faded ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-ink-900 text-[13px] font-medium">{task.title}</p>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="mt-1">
        <About task={task} />
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-2 text-xs">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {task.type && <span className="bg-ink-50 text-ink-700 rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap">{task.type.name}</span>}
          {task.deadline && <Deadline task={task} />}
          {task._count.comments > 0 && (
            <span className="text-ink-500 whitespace-nowrap">
              {task._count.comments} {task._count.comments === 1 ? "comment" : "comments"}
            </span>
          )}
        </span>
        <span className="shrink-0">
          <Assignees people={task.assignees} />
        </span>
      </div>
    </div>
  );
}

export function TaskTable({ tasks, compact = false }: { tasks: Task[]; compact?: boolean }) {
  return (
    <div className="border-ink-200/60 overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left">
        <thead className="bg-ink-50/60">
          <tr>
            <th className={th}>Task</th>
            <th className={th}>Status</th>
            <th className={th}>Priority</th>
            {!compact && <th className={th}>Type</th>}
            <th className={th}>To complete</th>
            {!compact && <th className={th}>Requested by</th>}
            <th className={th}>Deadline</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="hover:bg-ink-50/40">
              <td className={`${td} text-ink-900`}>
                <Link href={`/tasks/${task.id}`} className="hover:text-brand-700 font-medium">
                  {task.title}
                </Link>
                <span className="block">
                  <About task={task} />
                </span>
              </td>
              <td className={td}>
                <TaskStatusBadge status={task.status} />
              </td>
              <td className={td}>{task.priority ? <PriorityBadge priority={task.priority} /> : <span className="text-ink-400">—</span>}</td>
              {!compact && <td className={td}>{task.type?.name ?? <span className="text-ink-400">—</span>}</td>}
              <td className={td}>
                {task.assignees.length ? task.assignees.map(firstName).join(", ") : <span className="text-ink-400">Nobody yet</span>}
              </td>
              {!compact && <td className={td}>{task.requestedBy ? firstName(task.requestedBy) : <span className="text-ink-400">—</span>}</td>}
              <td className={td}>
                <Deadline task={task} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- The form ----------------------------------------------------------------

export type TaskPreset = { eventId?: string; propertyId?: string; clientId?: string; salesRequestId?: string };

type Draft = {
  title: string;
  details: string;
  status: TaskStatus;
  priority: Priority | "";
  deadline: string;
  typeId: string;
  assigneeIds: string[];
  requestedById: string;
  eventId: string;
  propertyId: string;
  clientId: string;
  salesRequestId: string;
};

/** A task added or changed: what it is, who completes it, by when, and what it is about. */
export function TaskForm({ task, preset, onDone }: { task?: NonNullable<RouterOutputs["task"]["byId"]>; preset?: TaskPreset; onDone?: () => void }) {
  const router = useRouter();
  const utils = api.useUtils();
  const me = api.user.me.useQuery();
  const people = api.user.list.useQuery();
  const types = api.task.types.useQuery();
  const events = api.event.list.useQuery();
  const clients = api.clients.list.useQuery();
  const properties = api.property.list.useQuery({});
  const requests = api.sales.list.useQuery({ show: "all" });

  const [draft, setDraft] = useState<Draft>({
    title: task?.title ?? "",
    details: task?.details ?? "",
    status: task?.status ?? "TODO",
    priority: task?.priority ?? "",
    deadline: task?.deadline ? dayKey(task.deadline) : "",
    typeId: task?.type?.id ?? "",
    assigneeIds: task?.assignees.map((person) => person.id) ?? [],
    requestedById: task?.requestedBy?.id ?? "",
    eventId: task?.event?.id ?? preset?.eventId ?? "",
    propertyId: task?.property?.id ?? preset?.propertyId ?? "",
    clientId: task?.client?.id ?? preset?.clientId ?? "",
    salesRequestId: task?.salesRequest?.id ?? preset?.salesRequestId ?? "",
  });
  // Whoever adds a task asked for it, unless someone else is chosen.
  useEffect(() => {
    if (!task && me.data && !draft.requestedById) setDraft((current) => ({ ...current, requestedById: me.data!.id }));
  }, [me.data, task, draft.requestedById]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const [newType, setNewType] = useState<string | null>(null);
  const addType = api.task.addType.useMutation({
    onSuccess: (type) => {
      void utils.task.types.invalidate();
      set("typeId", type.id);
      setNewType(null);
    },
  });

  const done = (id: string) => {
    void utils.task.invalidate();
    void utils.audit.invalidate();
    if (onDone) onDone();
    else router.push(`/tasks/${id}`);
  };
  const create = api.task.create.useMutation({ onSuccess: (saved) => done(saved.id) });
  const update = api.task.update.useMutation({ onSuccess: (saved) => done(saved.id) });
  const error = create.error ?? update.error ?? addType.error;
  const pending = create.isPending || update.isPending;

  const peopleList = people.data ?? [];
  const requestOptions = useMemo(
    () =>
      (requests.data ?? []).map((request) => ({
        id: request.id,
        label: `${request.client.name}${request.event ? ` · ${request.event.name}` : ""}`,
      })),
    [requests.data],
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const input = {
          title: draft.title,
          details: draft.details,
          status: draft.status,
          priority: draft.priority || null,
          deadline: draft.deadline,
          typeId: draft.typeId || null,
          assigneeIds: draft.assigneeIds,
          requestedById: draft.requestedById || null,
          eventId: draft.eventId || null,
          propertyId: draft.propertyId || null,
          clientId: draft.clientId || null,
          salesRequestId: draft.salesRequestId || null,
        };
        if (task) update.mutate({ id: task.id, ...input });
        else create.mutate(input);
      }}
    >
      <Field label="Task">
        <Input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Get photos and a video of Hotel Carmel" autoFocus={!task} />
      </Field>
      <Field label="Details">
        <Textarea rows={3} value={draft.details} onChange={(e) => set("details", e.target.value)} placeholder="Anything the person completing it needs to know" />
      </Field>

      <div>
        <Label>To complete — who does it</Label>
        <div className="flex flex-wrap gap-1.5">
          {peopleList.map((person) => {
            const chosen = draft.assigneeIds.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                aria-pressed={chosen}
                onClick={() =>
                  set("assigneeIds", chosen ? draft.assigneeIds.filter((id) => id !== person.id) : [...draft.assigneeIds, person.id])
                }
                className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                  chosen ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500 hover:text-ink-900 bg-white font-light"
                }`}
              >
                {person.name ?? person.email}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Requested by">
          <Select value={draft.requestedById} onChange={(e) => set("requestedById", e.target.value)}>
            <option value="">Nobody said</option>
            {peopleList.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deadline — optional">
          <Input type="date" value={draft.deadline} onChange={(e) => set("deadline", e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={draft.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
            {taskStatusOrder.map((option) => (
              <option key={option} value={option}>
                {taskStatusLabels[option]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={draft.priority} onChange={(e) => set("priority", e.target.value as Priority | "")}>
            <option value="">None</option>
            {priorityOrder.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabels[priority]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Type</Label>
          {newType === null ? (
            <Select value={draft.typeId} onChange={(e) => (e.target.value === "__new__" ? setNewType("") : set("typeId", e.target.value))}>
              <option value="">None</option>
              {(types.data ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
              <option value="__new__">+ New type…</option>
            </Select>
          ) : (
            <div className="flex gap-2">
              <Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Get media" autoFocus aria-label="New type" />
              <Button type="button" variant="secondary" disabled={!newType.trim() || addType.isPending} onClick={() => addType.mutate({ name: newType })}>
                Add
              </Button>
              <Button type="button" variant="ghost" onClick={() => setNewType(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      <div>
        <Label>About — each optional</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Combobox value={draft.eventId} onChange={(value) => set("eventId", value)} placeholder="No event" options={(events.data ?? []).map((event) => ({ id: event.id, label: event.name }))} />
          <Combobox
            value={draft.propertyId}
            onChange={(value) => set("propertyId", value)}
            placeholder="No property"
            options={(properties.data ?? []).map((property) => ({ id: property.id, label: property.name, detail: property.city }))}
          />
          <Combobox
            value={draft.clientId}
            onChange={(value) => set("clientId", value)}
            placeholder="No client"
            options={(clients.data ?? []).map((client) => ({ id: client.id, label: client.name, detail: client.shortName }))}
          />
          <Combobox value={draft.salesRequestId} onChange={(value) => set("salesRequestId", value)} placeholder="No sales request" options={requestOptions} />
        </div>
      </div>

      <FormError message={error ? friendlyError(error) : null} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !draft.title.trim()}>
          {pending ? "Saving…" : task ? "Save" : "Add task"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => (onDone ? onDone() : router.back())}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// --- One task ----------------------------------------------------------------

export function TaskView({ id }: { id: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const task = api.task.byId.useQuery({ id });
  const [editing, setEditing] = useState(false);
  const setStatus = api.task.update.useMutation({
    onSuccess: () => {
      void utils.task.invalidate();
      void utils.audit.invalidate();
    },
  });
  const remove = api.task.remove.useMutation({
    onSuccess: () => {
      void utils.task.invalidate();
      router.push("/tasks");
    },
  });
  if (task.isLoading) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  if (!task.data) return <EmptyState title="This task no longer exists" description="It may have been removed." />;
  const t = task.data;

  if (editing) {
    return (
      <div className="border-ink-200/60 rounded-xl border bg-white p-5">
        <TaskForm task={t} onDone={() => setEditing(false)} />
      </div>
    );
  }

  const rows: [string, React.ReactNode][] = [
    ["To complete", t.assignees.length ? t.assignees.map((person) => person.name ?? person.email).join(", ") : "Nobody yet"],
    ["Requested by", t.requestedBy ? (t.requestedBy.name ?? t.requestedBy.email) : "—"],
    ["Deadline", <Deadline key="d" task={t} />],
    ["Priority", t.priority ? <PriorityBadge key="p" priority={t.priority} /> : "—"],
    ["Type", t.type?.name ?? "—"],
    ["About", <About key="a" task={t as Task} />],
    ["Added", `${formatDay(t.createdAt)}${t.createdBy ? ` by ${t.createdBy.name ?? t.createdBy.email}` : ""}`],
  ];

  const sourcing = t.salesRequest && t.type?.name === "Sourcing";

  return (
    <div className="grid items-start gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {sourcing && (
          <div className="border-ink-200/60 rounded-xl border bg-white p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-ink-900 text-[15px] font-medium">Where to source</h2>
              <Link href={`/sales/${t.salesRequest!.id}`} className="text-brand-700 text-[13px] font-light hover:underline">
                The sales request →
              </Link>
            </div>
            <SourcingPanel salesRequestId={t.salesRequest!.id} />
          </div>
        )}
        <div className="border-ink-200/60 rounded-xl border bg-white p-5">
          <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Comments</h2>
          <TaskComments taskId={t.id} />
        </div>
      </div>

      <div className="space-y-5">
        <div className="border-ink-200/60 rounded-xl border bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-ink-900 text-[15px] font-medium">Details</h2>
            <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-light hover:underline">
              Edit
            </button>
          </div>
          {sourcing ? (
            <ClientRequest salesRequestId={t.salesRequest!.id} />
          ) : (
            t.details && (
              <div className="bg-ink-50/60 mb-4 rounded-lg px-3 py-2.5">
                <p className="text-ink-500 mb-1 text-[11px] font-medium tracking-wider uppercase">What to do</p>
                <p className="text-ink-900 text-sm font-light whitespace-pre-line">{t.details}</p>
              </div>
            )
          )}
          <dl className="space-y-2 text-sm font-light">
            {rows.map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <dt className="text-ink-500 w-28 shrink-0">{label}</dt>
                <dd className="text-ink-900 min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            onClick={() => window.confirm(`Remove the task "${t.title}"? Its comments go with it.`) && remove.mutate({ id: t.id })}
            className="mt-5 text-xs text-[#c03654] hover:underline"
          >
            Remove task
          </button>
        </div>

        <div className="border-ink-200/60 rounded-xl border bg-white p-5">
          <h2 className="text-ink-900 mb-4 text-[15px] font-medium">Status</h2>
          <TaskStatusSteps status={t.status} pending={setStatus.isPending} onMove={(status) => setStatus.mutate({ id: t.id, status })} />
          {setStatus.error && <FormError message={friendlyError(setStatus.error)} />}
        </div>
      </div>
    </div>
  );
}

/**
 * What the client asked, on a sourcing task (doc §4.11) — read from the
 * sales request itself, so it is always the latest: each line large, its
 * dates beneath; then the budget, the places and the client's words.
 */
function ClientRequest({ salesRequestId }: { salesRequestId: string }) {
  const request = api.sales.byId.useQuery({ id: salesRequestId });
  const r = request.data;
  if (!r) return <p className="text-ink-500 mb-4 text-sm font-light">{request.isLoading ? "…" : "The sales request is no longer there."}</p>;
  const places = [...r.closeTo.map((place) => place.name), ...r.closeToPoints.map((point) => point.label), r.closeToOther].filter(Boolean) as string[];
  return (
    <div className="border-brand-200 bg-brand-50/50 mb-4 rounded-lg border px-4 py-3">
      <p className="text-brand-800 mb-2 text-[11px] font-medium tracking-wider uppercase">What the client asked</p>
      {r.lines.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">No units given yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {r.lines.map((line) => (
            <li key={line.id}>
              <span className="text-ink-900 block text-[15px] font-semibold">
                {line.rooms} × {line.roomType ?? "units"}
              </span>
              <span className="text-ink-500 block text-xs font-light">
                {line.checkIn && line.checkOut
                  ? `${formatRange(line.checkIn, line.checkOut)} · ${nightsBetween(line.checkIn, line.checkOut)} nights`
                  : line.checkIn
                    ? `From ${formatDate(line.checkIn)}`
                    : "Dates not given"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(r.budgetCents !== null || places.length > 0 || r.clientComments) && (
        <div className="border-brand-200/70 mt-3 space-y-2 border-t pt-3 text-sm font-light">
          {r.budgetCents !== null && r.budgetCurrency && (
            <p>
              <span className="text-ink-500">Budget </span>
              <span className="text-ink-900 font-medium">{formatMoney(r.budgetCents, r.budgetCurrency)}</span>
              {r.budgetBasis && <span className="text-ink-500"> {budgetBasisWords[r.budgetBasis]}</span>}
            </p>
          )}
          {places.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-ink-500">Close to</span>
              {places.map((place) => (
                <span key={place} className="bg-ink-900 rounded-full px-2.5 py-0.5 text-xs text-white">
                  {place}
                </span>
              ))}
            </div>
          )}
          {r.clientComments && <p className="text-ink-700 italic">“{r.clientComments}”</p>}
        </div>
      )}
    </div>
  );
}

const budgetBasisWords = { PER_ROOM_NIGHT: "per room per night", PER_PERSON_NIGHT: "per person per night", TOTAL: "in total" } as const;

const nextMove: Record<TaskStatus, { to: TaskStatus; label: string } | null> = {
  BACKLOG: { to: "TODO", label: "Move to To do" },
  TODO: { to: "IN_PROGRESS", label: "Start it" },
  IN_PROGRESS: { to: "DONE", label: "Mark done" },
  DONE: null,
};

/**
 * Where a task stands (doc §2.8), as steps — passed ones ticked, the current
 * one marked, each a click away — with the next move as one button.
 */
function TaskStatusSteps({ status, pending, onMove }: { status: TaskStatus; pending: boolean; onMove: (status: TaskStatus) => void }) {
  const at = taskStatusOrder.indexOf(status);
  const done = status === "DONE";
  const next = nextMove[status];
  return (
    <div>
      <ol className="flex items-start">
        {taskStatusOrder.map((step, index) => {
          const passed = index < at || done;
          const current = index === at;
          const last = index === taskStatusOrder.length - 1;
          return (
            <li key={step} className={`flex items-start ${last ? "" : "flex-1"}`}>
              <button
                type="button"
                onClick={() => !current && onMove(step)}
                disabled={pending}
                title={taskStatusHints[step]}
                aria-current={current ? "step" : undefined}
                className="group flex w-16 shrink-0 flex-col items-center gap-1.5 text-center"
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[12px] font-semibold transition-colors ${
                    done
                      ? "border-[#0a7a47] bg-[#0a7a47] text-white"
                      : current
                        ? "border-brand-400 bg-brand-400 text-white"
                        : passed
                          ? "border-brand-400 text-brand-700 bg-white"
                          : "border-ink-200 group-hover:border-brand-300 text-ink-400 bg-white"
                  }`}
                >
                  {passed && !current ? "✓" : done ? "✓" : index + 1}
                </span>
                <span className={`text-[11px] leading-tight ${current ? "text-ink-900 font-medium" : passed ? "text-ink-700" : "text-ink-400 group-hover:text-ink-700"}`}>
                  {taskStatusLabels[step]}
                </span>
              </button>
              {!last && (
                <span
                  aria-hidden
                  className={`mt-3.5 h-0.5 min-w-2 flex-1 rounded ${index < at || done ? (done ? "bg-[#0a7a47]" : "bg-brand-400") : "bg-ink-200"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-ink-500 text-xs font-light">{taskStatusHints[status]}</p>
        {next ? (
          <Button type="button" disabled={pending} onClick={() => onMove(next.to)} className="shrink-0 whitespace-nowrap">
            {next.label} →
          </Button>
        ) : (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => onMove("IN_PROGRESS")} className="shrink-0">
            Reopen
          </Button>
        )}
      </div>
    </div>
  );
}

function TaskComments({ taskId }: { taskId: string }) {
  const utils = api.useUtils();
  const comments = api.task.comments.useQuery({ taskId });
  const people = api.user.list.useQuery();
  const me = api.user.me.useQuery();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const refresh = () => {
    void utils.task.comments.invalidate({ taskId });
    void utils.task.list.invalidate();
  };
  const post = api.task.comment.useMutation({
    onSuccess: () => {
      setBody("");
      refresh();
    },
  });
  const edit = api.task.editComment.useMutation({
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  return (
    <div className="space-y-4">
      <div>
        <MentionTextarea value={body} onChange={setBody} people={people.data ?? []} placeholder="Write a comment — @ to mention a colleague" rows={body ? 3 : 1} />
        {(body || post.error) && (
          <div className="mt-2 flex items-center justify-end gap-3">
            {post.error && <p className="mr-auto text-xs text-[#c03654]">{post.error.message}</p>}
            <Button type="button" disabled={!body.trim() || post.isPending} onClick={() => post.mutate({ taskId, body })}>
              {post.isPending ? "Posting…" : "Post comment"}
            </Button>
          </div>
        )}
      </div>
      {(comments.data ?? []).length === 0 ? (
        <p className="text-ink-500 text-sm font-light">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {(comments.data ?? []).map((comment) => (
            <li key={comment.id} className="border-ink-200/60 rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-900 text-[13px] font-medium">{comment.author?.name ?? comment.author?.email ?? "—"}</span>
                <span className="text-ink-500 flex items-baseline gap-3 text-xs font-light whitespace-nowrap">
                  {comment.author?.id === me.data?.id && editing?.id !== comment.id && (
                    <button type="button" onClick={() => setEditing({ id: comment.id, body: comment.body })} className="hover:text-brand-700">
                      Edit
                    </button>
                  )}
                  {formatMomentInWords(comment.createdAt)}
                </span>
              </div>
              {editing?.id === comment.id ? (
                <div className="mt-2">
                  <MentionTextarea value={editing.body} onChange={(value) => setEditing({ id: comment.id, body: value })} people={people.data ?? []} rows={3} />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button type="button" disabled={!editing.body.trim() || edit.isPending} onClick={() => edit.mutate(editing)}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-ink-700 mt-1 text-sm font-light whitespace-pre-line">{renderUpdateBody(comment.body)}</p>
                  {comment.editedAt && <p className="text-ink-500 mt-1 text-[11px] font-light italic">Edited {formatMomentInWords(comment.editedAt)}</p>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- My work -----------------------------------------------------------------

/** On your profile: what is yours to complete, and what you asked others for. */
export function MyWork() {
  const me = api.user.me.useQuery();
  const id = me.data?.id;
  const mine = api.task.list.useQuery({ assigneeId: id, doneWithinDays: 7 }, { enabled: Boolean(id) });
  const asked = api.task.list.useQuery({ requestedById: id, doneWithinDays: 7 }, { enabled: Boolean(id) });
  const open = (mine.data ?? []).filter((task) => task.status !== "DONE");
  const askedOpen = (asked.data ?? []).filter((task) => task.status !== "DONE" && !task.assignees.some((person) => person.id === id));
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-ink-900 text-[15px] font-medium">
            My work{open.length > 0 && <span className="text-ink-500 ml-1.5 text-xs font-light">{open.length} open</span>}
          </h2>
          <Link href="/tasks" className="text-brand-700 text-[13px] font-light hover:underline">
            The task board →
          </Link>
        </div>
        {open.length === 0 ? (
          <p className="text-ink-500 text-sm font-light">{mine.isLoading ? "…" : "Nothing for you to complete right now."}</p>
        ) : (
          <TaskTable tasks={open} compact />
        )}
      </div>
      {askedOpen.length > 0 && (
        <div>
          <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
            Asked of others<span className="text-ink-500 ml-1.5 text-xs font-light">{askedOpen.length} open</span>
          </h2>
          <TaskTable tasks={askedOpen} compact />
        </div>
      )}
    </div>
  );
}

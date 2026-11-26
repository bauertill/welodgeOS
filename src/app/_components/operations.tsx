"use client";

import type { DefectSeverity } from "generated/prisma";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ChecklistEditor, cleanChecklist } from "~/app/_components/checklist-editor";
import { Button, Field, FormError, friendlyError, Input, Select } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { dayKey } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import {
  defectStatusLabels,
  inspectionStatusLabels,
  readinessLabels,
  readinessStyles,
  severityLabels,
  severityOrder,
  severityStyles,
  type ChecklistSection,
  type Readiness,
} from "~/lib/inspections";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * The event's Operations tab (doc §6.10, Phase 3 step 3): every apartment we
 * hold, where it stands on the way to Ready for check-in, the inspections to
 * plan, and the defect inbox — what to fix, judge, or check.
 */

type Overview = RouterOutputs["inspection"]["overview"];
type Apartment = Overview["apartments"][number];
type InboxDefect = Overview["inbox"][number];

export function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${readinessStyles[readiness]}`}>{readinessLabels[readiness]}</span>;
}

export function SeverityBadge({ severity }: { severity: DefectSeverity }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${severityStyles[severity]}`}>{severityLabels[severity]}</span>;
}

const unitLabel = (apartment: Pick<Apartment, "unitNumber" | "slotNumber">) => (apartment.unitNumber ? `Apt ${apartment.unitNumber}` : `#${apartment.slotNumber}`);

export function OperationsBoard({ eventId }: { eventId: string }) {
  const overview = api.inspection.overview.useQuery({ eventId });
  const [chosen, setChosen] = useState<string[]>([]);
  const [planning, setPlanning] = useState<string[] | null>(null);
  const [checklistFor, setChecklistFor] = useState<{ categoryId: string; label: string } | null>(null);
  const [filter, setFilter] = useState<Readiness | null>(null);

  const apartments = overview.data?.apartments ?? [];
  const counts = useMemo(() => {
    const map = new Map<Readiness, number>();
    for (const apartment of apartments) map.set(apartment.readiness, (map.get(apartment.readiness) ?? 0) + 1);
    return map;
  }, [apartments]);
  const shown = filter ? apartments.filter((apartment) => apartment.readiness === filter) : apartments;
  const byProperty = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; rows: Apartment[] }>();
    for (const apartment of shown) {
      const group = groups.get(apartment.propertyId) ?? { id: apartment.propertyId, name: apartment.property, rows: [] };
      group.rows.push(apartment);
      groups.set(apartment.propertyId, group);
    }
    return [...groups.values()];
  }, [shown]);

  if (overview.isLoading) return <p className="text-ink-500 text-sm font-light">Loading the apartments…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ink-900 text-lg font-semibold">Apartments to get ready</h2>
          <p className="text-ink-500 max-w-2xl text-[13px] font-light">
            Every apartment we hold at this event. Plan an inspection, walk it on your phone, fix what it finds — until it is <strong className="font-medium">Ready for check-in</strong>. Hotels inspect their own rooms.
          </p>
        </div>
        <Link href="/checklists" className="text-brand-700 text-[13px] hover:underline">
          Standard checklists →
        </Link>
      </div>

      {apartments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(["NOT_PLANNED", "PLANNED", "IN_PROGRESS", "TO_FIX", "TO_CHECK", "READY"] as Readiness[]).map((readiness) => {
            const count = counts.get(readiness) ?? 0;
            if (!count) return null;
            const on = filter === readiness;
            return (
              <button
                key={readiness}
                type="button"
                onClick={() => setFilter(on ? null : readiness)}
                className={`rounded-full border px-3 py-1 text-[12px] ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-700 bg-white hover:border-brand-300"}`}
              >
                {readinessLabels[readiness]} <span className="ml-1 font-semibold">{count}</span>
              </button>
            );
          })}
          {filter && (
            <button type="button" onClick={() => setFilter(null)} className="text-ink-500 text-[12px] hover:underline">
              Show all
            </button>
          )}
        </div>
      )}

      <DefectInbox eventId={eventId} inbox={overview.data?.inbox ?? []} />

      {apartments.length === 0 ? (
        <div className="border-ink-200/60 rounded-xl border bg-white p-6 text-[13px] font-light">
          <p className="text-ink-900 font-medium">No apartments here yet.</p>
          <p className="text-ink-500 mt-1">An apartment shows once we have bought nights at an apartment-type property on this event, or sold them to a client.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!chosen.length} onClick={() => setPlanning(chosen)}>
              Plan inspection{chosen.length > 1 ? `s (${chosen.length})` : ""}
            </Button>
            <span className="text-ink-500 text-[12px] font-light">{chosen.length ? `${chosen.length} chosen` : "Tick apartments to plan their inspection together."}</span>
          </div>
          {byProperty.map((group) => {
            const roomTypes = [...new Map(group.rows.map((row) => [row.categoryId, row.roomType])).entries()];
            const allChosen = group.rows.every((row) => chosen.includes(row.slotId));
            return (
              <div key={group.id} className="border-ink-200/60 overflow-hidden rounded-xl border bg-white">
                <div className="border-ink-200/60 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allChosen}
                      onChange={() => setChosen(allChosen ? chosen.filter((id) => !group.rows.some((row) => row.slotId === id)) : [...new Set([...chosen, ...group.rows.map((row) => row.slotId)])])}
                      className="accent-brand-500"
                    />
                    <Link href={`/properties/${group.id}`} className="text-ink-900 font-semibold hover:underline">
                      {group.name}
                    </Link>
                  </label>
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                    {roomTypes.map(([categoryId, name]) => (
                      <button key={categoryId} type="button" onClick={() => setChecklistFor({ categoryId, label: `${group.name} · ${name}` })} className="text-brand-700 hover:underline">
                        {name} checklist
                      </button>
                    ))}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead>
                      <tr className="text-ink-500 border-ink-200/60 border-b text-[10px] tracking-wider uppercase">
                        <th className="w-8 px-4 py-2" />
                        <th className="px-2 py-2 font-medium">Apartment</th>
                        <th className="px-2 py-2 font-medium">First check-in</th>
                        <th className="px-2 py-2 font-medium">Inspection</th>
                        <th className="px-2 py-2 font-medium">Defects</th>
                        <th className="px-2 py-2 font-medium">Stands</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-ink-200/40 divide-y">
                      {group.rows.map((row) => (
                        <tr key={row.slotId}>
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              checked={chosen.includes(row.slotId)}
                              onChange={() => setChosen(chosen.includes(row.slotId) ? chosen.filter((id) => id !== row.slotId) : [...chosen, row.slotId])}
                              className="accent-brand-500"
                              aria-label={`Choose ${unitLabel(row)}`}
                            />
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="text-ink-900 font-medium">{unitLabel(row)}</span> <span className="text-ink-500 font-light">· {row.roomType}</span>
                          </td>
                          <td className="text-ink-700 px-2 py-2.5 font-light">{row.firstCheckIn ? formatDate(row.firstCheckIn) : "—"}</td>
                          <td className="text-ink-700 px-2 py-2.5 font-light">
                            {row.inspection
                              ? [inspectionStatusLabels[row.inspection.status], row.inspection.scheduledOn ? formatDate(row.inspection.scheduledOn) : null, row.inspection.inspector?.name?.split(" ")[0]].filter(Boolean).join(" · ")
                              : "—"}
                          </td>
                          <td className="text-ink-700 px-2 py-2.5 font-light">{row.openDefects ? `${row.openDefects} open${row.blocking ? `, ${row.blocking} stop check-in` : ""}` : "—"}</td>
                          <td className="px-2 py-2.5">
                            <ReadinessBadge readiness={row.readiness} />
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {row.inspection ? (
                              <Link href={`/inspections/${row.inspection.id}`} className="text-brand-700 hover:underline">
                                Open
                              </Link>
                            ) : (
                              <button type="button" onClick={() => setPlanning([row.slotId])} className="text-brand-700 hover:underline">
                                Plan
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {planning && (
        <PlanPopup
          eventId={eventId}
          slotIds={planning}
          onClose={() => setPlanning(null)}
          onDone={() => {
            setPlanning(null);
            setChosen([]);
            void overview.refetch();
          }}
        />
      )}
      {checklistFor && <RoomTypeChecklist categoryId={checklistFor.categoryId} label={checklistFor.label} onClose={() => setChecklistFor(null)} />}
    </div>
  );
}

function PlanPopup({ eventId, slotIds, onClose, onDone }: { eventId: string; slotIds: string[]; onClose: () => void; onDone: () => void }) {
  const team = api.user.list.useQuery();
  const me = api.user.me.useQuery();
  const [day, setDay] = useState(dayKey(new Date()));
  const [inspectorId, setInspectorId] = useState<string>("");
  const plan = api.inspection.plan.useMutation({ onSuccess: onDone });
  const chosenInspector = inspectorId || me.data?.id || "";
  return (
    <Popup size="medium" title={slotIds.length > 1 ? `Plan ${slotIds.length} inspections` : "Plan the inspection"} subtitle="The inspector gets a task on the board for that day." onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          plan.mutate({ eventId, slotIds, scheduledOn: day, inspectorId: chosenInspector || null });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Day" hint="As early as possible — a week before check-in at best.">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Who goes">
            <Select value={chosenInspector} onChange={(e) => setInspectorId(e.target.value)}>
              <option value="">Nobody yet</option>
              {(team.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? person.email}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <FormError message={plan.error ? friendlyError(plan.error) : null} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={plan.isPending}>
            {plan.isPending ? "Planning…" : "Plan"}
          </Button>
        </div>
      </form>
    </Popup>
  );
}

/** A room type's checklist — the standard one until adjusted for what this apartment has. */
function RoomTypeChecklist({ categoryId, label, onClose }: { categoryId: string; label: string; onClose: () => void }) {
  const current = api.inspection.roomTypeChecklist.useQuery({ categoryId });
  const templates = api.inspection.templates.useQuery();
  const [draft, setDraft] = useState<ChecklistSection[] | null>(null);
  const utils = api.useUtils();
  const save = api.inspection.setRoomTypeChecklist.useMutation({
    onSuccess: () => {
      void utils.inspection.roomTypeChecklist.invalidate({ categoryId });
      onClose();
    },
  });
  const sections = draft ?? current.data?.sections ?? [];
  return (
    <Popup
      title={`${label} — checklist`}
      subtitle={current.data?.own ? "Adjusted for this room type. Inspections already planned keep the checklist they were planned with." : "Using the standard checklist. Change anything to adjust it for this room type."}
      onClose={onClose}
    >
      {current.isLoading ? (
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      ) : (
        <div className="space-y-4">
          {(templates.data?.length ?? 0) > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-ink-700">Start again from</span>
              <Select
                className="w-auto"
                value=""
                onChange={(e) => {
                  const template = templates.data?.find((one) => one.id === e.target.value);
                  if (template) setDraft(template.sections as ChecklistSection[]);
                }}
              >
                <option value="">a standard checklist…</option>
                {templates.data?.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <ChecklistEditor sections={sections} onChange={setDraft} />
          <FormError message={save.error ? friendlyError(save.error) : null} />
          <div className="bg-ink-50/95 sticky bottom-0 flex flex-wrap justify-end gap-2 py-3">
            {current.data?.own && (
              <Button type="button" variant="ghost" onClick={() => save.mutate({ categoryId, sections: null })}>
                Back to the standard checklist
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={!draft || save.isPending} onClick={() => draft && save.mutate({ categoryId, sections: cleanChecklist(draft) })}>
              {save.isPending ? "Saving…" : "Save for this room type"}
            </Button>
          </div>
        </div>
      )}
    </Popup>
  );
}

/** What needs someone: open defects (to judge or to give a task), and fixed ones to check. */
function DefectInbox({ eventId, inbox }: { eventId: string; inbox: InboxDefect[] }) {
  const utils = api.useUtils();
  const refresh = () => void utils.inspection.overview.invalidate({ eventId });
  const update = api.inspection.updateDefect.useMutation({ onSuccess: refresh });
  const check = api.inspection.check.useMutation({ onSuccess: refresh });
  const [tasking, setTasking] = useState<InboxDefect | null>(null);
  if (!inbox.length) return null;
  const sorted = [...inbox].sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
  return (
    <div className="border-ink-200/60 overflow-hidden rounded-xl border bg-white">
      <div className="border-ink-200/60 border-b px-4 py-3">
        <p className="text-ink-900 font-semibold">Defect inbox · {inbox.length}</p>
        <p className="text-ink-500 text-[12px] font-light">Judge the &ldquo;not sure&rdquo; ones, give each a cleaning, maintenance or other task, and check them once fixed.</p>
      </div>
      <ul className="divide-ink-200/40 divide-y">
        {sorted.map((defect) => (
          <li key={defect.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={defect.severity} />
                <span className="text-ink-900 text-[13px] font-medium">{defect.description}</span>
              </p>
              <p className="text-ink-500 mt-0.5 text-[12px] font-light">
                {defect.unit}
                {defect.area ? ` · ${defect.area}` : ""} · {defectStatusLabels[defect.status]}
                {defect.task ? (
                  <>
                    {" · "}
                    <Link href={`/tasks/${defect.task.id}`} className="text-brand-700 hover:underline">
                      task{defect.task.assignees.length ? ` with ${defect.task.assignees.map((person) => person.name?.split(" ")[0]).join(", ")}` : ""}
                    </Link>
                  </>
                ) : null}
                {defect.inspectionId && (
                  <>
                    {" · "}
                    <Link href={`/inspections/${defect.inspectionId}`} className="text-brand-700 hover:underline">
                      inspection
                    </Link>
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {defect.severity === "NOT_SURE" && (
                <Select className="w-auto py-1 text-[12px]" value="" onChange={(e) => e.target.value && update.mutate({ id: defect.id, severity: e.target.value as DefectSeverity })}>
                  <option value="">Decide how serious…</option>
                  {(["BEFORE_CHECK_IN", "MUST_FIX", "DOCUMENT"] as DefectSeverity[]).map((severity) => (
                    <option key={severity} value={severity}>
                      {severityLabels[severity]}
                    </option>
                  ))}
                </Select>
              )}
              {defect.status === "OPEN" && !defect.task && (
                <Button type="button" variant="secondary" className="px-3 py-1 text-[12px]" onClick={() => setTasking(defect)}>
                  Make a task
                </Button>
              )}
              {defect.status === "FIXED" && (
                <>
                  <Button type="button" className="px-3 py-1 text-[12px]" onClick={() => check.mutate({ id: defect.id, fixed: true })}>
                    Checked — fixed
                  </Button>
                  <Button type="button" variant="danger" className="px-3 py-1 text-[12px]" onClick={() => check.mutate({ id: defect.id, fixed: false })}>
                    Not fixed
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {tasking && <DefectTaskPopup defect={tasking} onClose={() => setTasking(null)} onDone={() => (setTasking(null), refresh())} />}
    </div>
  );
}

export function DefectTaskPopup({ defect, onClose, onDone }: { defect: { id: string; description: string; severity: DefectSeverity }; onClose: () => void; onDone: () => void }) {
  const team = api.user.list.useQuery();
  const [kind, setKind] = useState<"Cleaning" | "Maintenance" | "Other">(/clean|dirty|smell|dust|stain/i.test(defect.description) ? "Cleaning" : "Maintenance");
  const [assigneeId, setAssigneeId] = useState("");
  const [deadline, setDeadline] = useState("");
  const make = api.inspection.defectTask.useMutation({ onSuccess: onDone });
  return (
    <Popup size="medium" title="Make a task for this defect" subtitle={defect.description} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          make.mutate({ defectId: defect.id, kind, assigneeIds: assigneeId ? [assigneeId] : [], deadline });
        }}
      >
        <div className="flex flex-wrap gap-2">
          {(["Cleaning", "Maintenance", "Other"] as const).map((one) => (
            <button
              key={one}
              type="button"
              onClick={() => setKind(one)}
              className={`rounded-full border px-4 py-1.5 text-[13px] ${kind === one ? "border-brand-500 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-700"}`}
            >
              {one}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who fixes it">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Nobody yet</option>
              {(team.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? person.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="By">
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
        <p className="text-ink-500 text-xs font-light">When the task is marked Done, the defect waits to be checked on the apartment.</p>
        <FormError message={make.error ? friendlyError(make.error) : null} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={make.isPending}>
            {make.isPending ? "Making…" : "Make the task"}
          </Button>
        </div>
      </form>
    </Popup>
  );
}

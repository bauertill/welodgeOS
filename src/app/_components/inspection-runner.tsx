"use client";

import type { DefectSeverity } from "generated/prisma";
import { upload } from "@vercel/blob/client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, FormError, friendlyError, Textarea } from "~/app/_components/form";
import { DefectTaskPopup, ReadinessBadge, SeverityBadge } from "~/app/_components/operations";
import { formatDate } from "~/lib/format";
import { defectStatusLabels, inspectionStatusLabels, missingText, severityHints, severityLabels, severityOrder, type ChecklistItem, type ChecklistSection, type Readiness } from "~/lib/inspections";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * An apartment inspection, walked on a phone (doc §6.10): the photo dump, the
 * facility check ticked, the inventory counted, a defect for anything not
 * right — with how serious, or "not sure" — then Finish. Ready for check-in
 * gets its moment.
 */

type Inspection = NonNullable<RouterOutputs["inspection"]["byId"]>;
type Defect = Inspection["defects"][number];
type Photo = { url: string; name?: string | null };
type Answer = { ok: boolean | null; count: number | null };

/** A photo into the site's private store; its link back. */
function useUploader() {
  const record = api.files.record.useMutation();
  return async (file: File): Promise<Photo> => {
    const blob = await upload(`uploads/${file.name}`, file, { access: "private", handleUploadUrl: "/api/files/upload", clientPayload: "store", multipart: file.size > 8 * 1024 * 1024 });
    const saved = await record.mutateAsync({ pathname: blob.pathname, name: file.name });
    return { url: saved.url, name: file.name };
  };
}

export function InspectionRunner({ id }: { id: string }) {
  const query = api.inspection.byId.useQuery({ id });
  const utils = api.useUtils();
  const refresh = () => void utils.inspection.byId.invalidate({ id });
  const start = api.inspection.start.useMutation({ onSuccess: refresh });
  const setResult = api.inspection.setResult.useMutation();
  const finish = api.inspection.finish.useMutation();
  const reopen = api.inspection.reopen.useMutation({ onSuccess: refresh });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [memo, setMemo] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [adding, setAdding] = useState(false);
  const data = query.data;

  useEffect(() => {
    if (!data) return;
    setAnswers(Object.fromEntries(data.results.map((result) => [result.itemId, { ok: result.ok, count: result.count }])));
  }, [data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) return <p className="text-ink-500 p-4 text-sm font-light">Loading the inspection…</p>;
  if (!data) return <p className="text-ink-500 p-4 text-sm">This inspection no longer exists.</p>;

  const editable = data.status === "IN_PROGRESS";
  const answer = (item: ChecklistItem, change: Partial<Answer>) => {
    const next = { ok: null, count: null, ...answers[item.id], ...change };
    setAnswers((current) => ({ ...current, [item.id]: next }));
    setResult.mutate({ inspectionId: id, itemId: item.id, ok: next.ok, count: next.count });
  };
  const allItems = data.checklist.flatMap((section) => section.items);
  const answered = allItems.filter((item) => {
    const a = answers[item.id];
    return a && (a.ok !== null || a.count !== null);
  }).length;
  const defectFor = (itemId: string) => data.defects.find((defect) => defect.itemId === itemId && defect.inspectionId === id && defect.status !== "CHECKED");
  const looseDefects = data.defects.filter((defect) => !defect.itemId || defect.inspectionId !== id);

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-28">
      {/* Header */}
      <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)] md:p-5">
        <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
          <Link href={`/events/${data.event.id}/operations`} className="hover:underline">
            {data.event.name} · Operations
          </Link>
        </p>
        <h1 className="text-ink-900 mt-1 text-xl leading-tight font-semibold md:text-2xl">{data.unit}</h1>
        <p className="text-ink-500 mt-1 text-[13px] font-light">
          {[data.slot.category.name, data.scheduledOn ? formatDate(data.scheduledOn) : null, data.inspector?.name ?? data.inspector?.email, inspectionStatusLabels[data.status]].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReadinessBadge readiness={data.readiness} />
          {editable && (
            <span className="text-ink-500 text-[12px] font-light">
              {answered} of {allItems.length} checked
            </span>
          )}
        </div>
        {data.status === "PLANNED" && (
          <Button type="button" className="mt-4 w-full justify-center py-3 text-[15px] font-medium md:w-auto" onClick={() => start.mutate({ id })} disabled={start.isPending}>
            Start the inspection
          </Button>
        )}
        {data.status === "DONE" && (
          <p className="text-ink-500 mt-3 text-[12px] font-light">
            Finished {data.finishedAt ? formatDate(data.finishedAt) : ""}.{" "}
            <button type="button" className="text-brand-700 hover:underline" onClick={() => reopen.mutate({ id })}>
              Reopen to change it
            </button>
          </p>
        )}
      </div>

      <Photos inspectionId={id} photos={data.photos} editable={editable} onChange={refresh} />

      {data.checklist.map((section) => (
        <SectionCard key={section.id} section={section}>
          {section.items.map((item) =>
            section.kind === "facility" ? (
              <FacilityRow
                key={item.id}
                item={item}
                answer={answers[item.id]}
                editable={editable}
                defect={defectFor(item.id)}
                onAnswer={(ok) => answer(item, { ok })}
                inspectionId={id}
                area={section.area}
                onSaved={refresh}
              />
            ) : (
              <InventoryRow
                key={item.id}
                item={item}
                answer={answers[item.id]}
                editable={editable}
                defect={defectFor(item.id)}
                onCount={(count) => answer(item, { count, ok: item.expected === null ? null : count >= item.expected })}
                inspectionId={id}
                area={section.area}
                onSaved={refresh}
              />
            ),
          )}
        </SectionCard>
      ))}

      {/* Other defects: cleaning, smells, damage not on the list */}
      <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-ink-900 font-semibold">Other defects</p>
          {editable && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="text-brand-700 text-[13px] font-medium">
              + Add a defect
            </button>
          )}
        </div>
        <p className="text-ink-500 text-[12px] font-light">Cleaning needed, a bad smell, a scratch — anything not on the checklist.</p>
        {adding && (
          <DefectForm
            inspectionId={id}
            areas={[...new Set(data.checklist.map((section) => section.area))]}
            onDone={() => {
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        <ul className="mt-2 space-y-2">
          {looseDefects.map((defect) => (
            <DefectCard key={defect.id} defect={defect} onChange={refresh} />
          ))}
        </ul>
      </div>

      {/* Fixed, waiting to be checked — and every defect of this apartment */}
      {data.defects.some((defect) => defect.status !== "OPEN" || defect.task) && (
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-ink-900 font-semibold">Being fixed and to check</p>
          <ul className="mt-2 space-y-2">
            {data.defects
              .filter((defect) => defect.status !== "OPEN" || defect.task)
              .map((defect) => (
                <DefectCard key={defect.id} defect={defect} onChange={refresh} onReadiness={(readiness) => readiness === "READY" && setCelebrate(true)} />
              ))}
          </ul>
        </div>
      )}

      {editable && (
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-ink-900 font-semibold">Memo</p>
          <Textarea rows={3} className="mt-2" value={memo ?? data.memo ?? ""} onChange={(e) => setMemo(e.target.value)} placeholder="Anything else the team should know about this apartment" />
          <FormError message={finish.error ? friendlyError(finish.error) : null} />
          <Button
            type="button"
            className="mt-3 w-full justify-center py-3 text-[15px] font-medium"
            disabled={finish.isPending}
            onClick={() =>
              finish.mutate(
                { id, memo: memo ?? data.memo ?? "" },
                {
                  onSuccess: (result) => {
                    if (result.readiness === "READY") setCelebrate(true);
                    refresh();
                  },
                },
              )
            }
          >
            {finish.isPending ? "Finishing…" : "Finish the inspection"}
          </Button>
          {answered < allItems.length && <p className="text-ink-500 mt-2 text-center text-[12px] font-light">{allItems.length - answered} items not checked yet.</p>}
        </div>
      )}

      {celebrate && <ReadyCelebration unit={data.unit} onClose={() => setCelebrate(false)} />}
    </div>
  );
}

function SectionCard({ section, children }: { section: ChecklistSection; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="bg-ink-900 flex items-baseline justify-between px-4 py-2.5 text-white">
        <p className="font-semibold">{section.area}</p>
        <p className="text-[11px] tracking-wider text-white/60 uppercase">{section.kind === "facility" ? "Facility check" : "Inventory"}</p>
      </div>
      <ul className="divide-ink-200/50 divide-y">{children}</ul>
    </div>
  );
}

function FacilityRow({
  item,
  answer,
  editable,
  defect,
  onAnswer,
  inspectionId,
  area,
  onSaved,
}: {
  item: ChecklistItem;
  answer?: Answer;
  editable: boolean;
  defect?: Defect;
  onAnswer: (ok: boolean) => void;
  inspectionId: string;
  area: string;
  onSaved: () => void;
}) {
  const ok = answer?.ok ?? null;
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-ink-900 min-w-0 flex-1 text-[14px]">{item.label}</span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={!editable}
            onClick={() => onAnswer(true)}
            className={`h-10 w-12 rounded-xl border text-[18px] transition-colors ${ok === true ? "border-[#0a7a47] bg-[#0a7a47] text-white" : "border-ink-200 text-ink-500"} disabled:opacity-60`}
            aria-label={`${item.label} works`}
          >
            ✓
          </button>
          <button
            type="button"
            disabled={!editable}
            onClick={() => onAnswer(false)}
            className={`h-10 w-12 rounded-xl border text-[18px] transition-colors ${ok === false ? "border-[#c03654] bg-[#c03654] text-white" : "border-ink-200 text-ink-500"} disabled:opacity-60`}
            aria-label={`${item.label} not right`}
          >
            ✗
          </button>
        </div>
      </div>
      {defect ? (
        <DefectSummary defect={defect} editable={editable} onChange={onSaved} />
      ) : ok === false && editable ? (
        <DefectForm inspectionId={inspectionId} itemId={item.id} area={area} initial={`${item.label} — not working`} onDone={onSaved} />
      ) : null}
    </li>
  );
}

function InventoryRow({
  item,
  answer,
  editable,
  defect,
  onCount,
  inspectionId,
  area,
  onSaved,
}: {
  item: ChecklistItem;
  answer?: Answer;
  editable: boolean;
  defect?: Defect;
  onCount: (count: number) => void;
  inspectionId: string;
  area: string;
  onSaved: () => void;
}) {
  const count = answer?.count ?? null;
  const missing = item.expected !== null && count !== null ? item.expected - count : 0;
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-ink-900 min-w-0 flex-1 text-[14px]">
          {item.label}
          {item.expected !== null && <span className="text-ink-500 block text-[12px] font-light">should be {item.expected}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.expected !== null && (
            <button
              type="button"
              disabled={!editable}
              onClick={() => onCount(item.expected!)}
              className={`h-10 rounded-xl border px-2.5 text-[12px] ${count !== null && count >= item.expected ? "border-[#0a7a47] bg-[#0a7a47] text-white" : "border-ink-200 text-ink-500"} disabled:opacity-60`}
            >
              All there
            </button>
          )}
          <button type="button" disabled={!editable || (count ?? item.expected ?? 0) <= 0} onClick={() => onCount(Math.max(0, (count ?? item.expected ?? 0) - 1))} className="border-ink-200 text-ink-700 h-10 w-10 rounded-xl border text-[18px] disabled:opacity-40" aria-label="One fewer">
            −
          </button>
          <span className={`w-8 text-center text-[16px] font-semibold ${missing > 0 ? "text-[#c03654]" : "text-ink-900"}`}>{count ?? "–"}</span>
          <button type="button" disabled={!editable} onClick={() => onCount(count === null ? (item.expected ?? 1) : count + 1)} className="border-ink-200 text-ink-700 h-10 w-10 rounded-xl border text-[18px] disabled:opacity-40" aria-label="One more">
            +
          </button>
        </div>
      </div>
      {defect ? (
        <DefectSummary defect={defect} editable={editable} onChange={onSaved} />
      ) : missing > 0 && editable ? (
        <DefectForm key={missing} inspectionId={inspectionId} itemId={item.id} area={area} initial={missingText(item.label, missing, area)} onDone={onSaved} />
      ) : null}
    </li>
  );
}

function SeverityPicker({ value, onChange }: { value: DefectSeverity | null; onChange: (severity: DefectSeverity) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {severityOrder.map((severity) => (
        <button
          key={severity}
          type="button"
          onClick={() => onChange(severity)}
          className={`rounded-xl border px-3 py-2 text-left ${value === severity ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white"}`}
        >
          <span className="text-ink-900 block text-[13px] font-semibold">{severityLabels[severity]}</span>
          <span className="text-ink-500 block text-[11px] font-light">{severityHints[severity]}</span>
        </button>
      ))}
    </div>
  );
}

function DefectForm({
  inspectionId,
  itemId,
  area,
  areas,
  initial = "",
  onDone,
  onCancel,
}: {
  inspectionId: string;
  itemId?: string;
  area?: string;
  areas?: string[];
  initial?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [description, setDescription] = useState(initial);
  const [severity, setSeverity] = useState<DefectSeverity | null>(null);
  const [where, setWhere] = useState(area ?? "");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadPhoto = useUploader();
  const add = api.inspection.addDefect.useMutation({ onSuccess: onDone });
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="bg-ink-50/70 mt-3 space-y-3 rounded-xl p-3">
      {areas && (
        <div className="flex flex-wrap gap-1.5">
          {areas.map((one) => (
            <button key={one} type="button" onClick={() => setWhere(one)} className={`rounded-full border px-2.5 py-1 text-[12px] ${where === one ? "border-brand-500 bg-white text-brand-800" : "border-ink-200 text-ink-500"}`}>
              {one}
            </button>
          ))}
        </div>
      )}
      <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is wrong — dirty fridge, broken handle…" aria-label="What is wrong" />
      <SeverityPicker value={severity} onChange={setSeverity} />
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((photo) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={photo.url} src={photo.url} alt="" className="h-14 w-14 rounded-lg object-cover" />
        ))}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            setUploading(true);
            try {
              const done: Photo[] = [];
              for (const file of files) done.push(await uploadPhoto(file));
              setPhotos((current) => [...current, ...done]);
            } finally {
              setUploading(false);
            }
          }}
        />
        <button type="button" onClick={() => input.current?.click()} className="border-ink-200 text-ink-700 rounded-xl border bg-white px-3 py-2 text-[13px]">
          {uploading ? "Uploading…" : "📷 Add photo"}
        </button>
      </div>
      <FormError message={add.error ? friendlyError(add.error) : null} />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          disabled={!severity || !description.trim() || add.isPending || uploading}
          onClick={() => severity && add.mutate({ inspectionId, itemId: itemId ?? null, area: where || null, description, severity, photos })}
        >
          {add.isPending ? "Saving…" : "Save defect"}
        </Button>
      </div>
      {!severity && <p className="text-ink-500 text-right text-[11px] font-light">Choose how serious — or Not sure.</p>}
    </div>
  );
}

function DefectSummary({ defect, editable, onChange }: { defect: Defect; editable: boolean; onChange: () => void }) {
  const remove = api.inspection.removeDefect.useMutation({ onSuccess: onChange });
  return (
    <div className="bg-ink-50/70 mt-2 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[13px]">
      <SeverityBadge severity={defect.severity} />
      <span className="text-ink-700 min-w-0 flex-1">{defect.description}</span>
      <span className="text-ink-500 text-[11px]">{defect.photos.length ? `${defect.photos.length} photo${defect.photos.length === 1 ? "" : "s"}` : ""}</span>
      {editable && !defect.task && defect.status === "OPEN" && (
        <button type="button" onClick={() => remove.mutate({ id: defect.id })} className="text-ink-500 text-[12px] hover:text-[#c03654]">
          Remove
        </button>
      )}
    </div>
  );
}

function DefectCard({ defect, onChange, onReadiness }: { defect: Defect; onChange: () => void; onReadiness?: (readiness: Readiness) => void }) {
  const markFixed = api.inspection.markFixed.useMutation({ onSuccess: onChange });
  const remove = api.inspection.removeDefect.useMutation({ onSuccess: onChange });
  const check = api.inspection.check.useMutation({
    onSuccess: (result) => {
      onReadiness?.(result.readiness);
      onChange();
    },
  });
  const [tasking, setTasking] = useState(false);
  return (
    <li className="border-ink-200/60 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={defect.severity} />
        <span className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">{defectStatusLabels[defect.status]}</span>
      </div>
      <p className="text-ink-900 mt-1 text-[14px]">
        {defect.area ? <span className="text-ink-500">{defect.area}: </span> : null}
        {defect.description}
      </p>
      {defect.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {defect.photos.map((photo) => (
            <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="h-14 w-14 rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}
      {defect.task && (
        <p className="text-ink-500 mt-1 text-[12px] font-light">
          <Link href={`/tasks/${defect.task.id}`} className="text-brand-700 hover:underline">
            {defect.task.title}
          </Link>
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {defect.status === "FIXED" && (
          <>
            <Button type="button" className="px-3 py-1.5 text-[12px]" onClick={() => check.mutate({ id: defect.id, fixed: true })}>
              Checked — fixed
            </Button>
            <Button type="button" variant="danger" className="px-3 py-1.5 text-[12px]" onClick={() => check.mutate({ id: defect.id, fixed: false })}>
              Not fixed
            </Button>
          </>
        )}
        {defect.status === "OPEN" && (
          <>
            {!defect.task && (
              <Button type="button" variant="secondary" className="px-3 py-1.5 text-[12px]" onClick={() => setTasking(true)}>
                Make a task
              </Button>
            )}
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-[12px]" onClick={() => markFixed.mutate({ id: defect.id })}>
              Fixed on the spot
            </Button>
            {!defect.task && (
              <Button type="button" variant="ghost" className="px-2 py-1.5 text-[12px]" onClick={() => remove.mutate({ id: defect.id })}>
                Remove
              </Button>
            )}
          </>
        )}
      </div>
      {tasking && <DefectTaskPopup defect={defect} onClose={() => setTasking(false)} onDone={() => (setTasking(false), onChange())} />}
    </li>
  );
}

function Photos({ inspectionId, photos, editable, onChange }: { inspectionId: string; photos: { id: string; url: string; name: string | null }[]; editable: boolean; onChange: () => void }) {
  const add = api.inspection.addPhotos.useMutation({ onSuccess: onChange });
  const remove = api.inspection.removePhoto.useMutation({ onSuccess: onChange });
  const uploadPhoto = useUploader();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [failed, setFailed] = useState(0);
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-ink-900 font-semibold">Photos · {photos.length}</p>
          <p className="text-ink-500 text-[12px] font-light">Every room, from every angle — before anyone moves in.</p>
        </div>
        {editable && (
          <button type="button" onClick={() => input.current?.click()} disabled={progress !== null} className="bg-brand-500 rounded-xl px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-60">
            {progress ? `Uploading ${progress.done}/${progress.of}…` : "📷 Add photos"}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setFailed(0);
          setProgress({ done: 0, of: files.length });
          const batch: Photo[] = [];
          let bad = 0;
          for (const [index, file] of files.entries()) {
            try {
              batch.push(await uploadPhoto(file));
            } catch {
              bad++;
            }
            setProgress({ done: index + 1, of: files.length });
            // Saved in tens, so a long dump is not lost if the phone drops out.
            if (batch.length === 10) await add.mutateAsync({ inspectionId, photos: batch.splice(0) });
          }
          if (batch.length) await add.mutateAsync({ inspectionId, photos: batch });
          setProgress(null);
          setFailed(bad);
        }}
      />
      {failed > 0 && <p className="mt-2 text-[12px] text-[#c03654]">{failed} photo{failed === 1 ? "" : "s"} could not be uploaded — try them again.</p>}
      {photos.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative">
              <a href={photo.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.name ?? ""} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
              </a>
              {editable && (
                <button
                  type="button"
                  onClick={() => remove.mutate({ id: photo.id })}
                  className="absolute top-1 right-1 hidden h-6 w-6 rounded-full bg-black/60 text-[13px] text-white group-hover:block"
                  aria-label="Remove photo"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ready for check-in: a moment for the ground staff (the owner: "get that dopamine"). */
function ReadyCelebration({ unit, onClose }: { unit: string; onClose: () => void }) {
  const colours = ["#7c5cff", "#d9f99d", "#ff6b8b", "#ffd166", "#4cc9f0", "#0a7a47"];
  const pieces = Array.from({ length: 70 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: (i % 14) * 0.08,
    duration: 2.2 + ((i * 13) % 10) / 10,
    colour: colours[i % colours.length]!,
    size: 6 + (i % 4) * 2,
    turn: (i * 47) % 360,
  }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/40 p-6" onClick={onClose} role="dialog" aria-label="Ready for check-in">
      <style>{`@keyframes wl-fall { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1 } 100% { transform: translateY(110vh) rotate(720deg); opacity: 0.9 } }
@keyframes wl-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.06); opacity: 1 } 100% { transform: scale(1) } }`}</style>
      {pieces.map((piece, i) => (
        <span
          key={i}
          className="pointer-events-none absolute top-0 rounded-[2px]"
          style={{ left: `${piece.left}%`, width: piece.size, height: piece.size * 1.6, background: piece.colour, transform: `rotate(${piece.turn}deg)`, animation: `wl-fall ${piece.duration}s ${piece.delay}s ease-in forwards` }}
        />
      ))}
      <div className="relative w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl" style={{ animation: "wl-pop 0.5s ease-out" }}>
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#d9f99d] text-[40px] text-[#2f4a00]">✓</div>
        <p className="text-ink-900 mt-5 text-2xl font-semibold">Ready for check-in!</p>
        <p className="text-ink-500 mt-2 text-[14px] font-light">{unit} is all set for its guests. Great work.</p>
        <button type="button" onClick={onClose} className="bg-brand-500 mt-6 w-full rounded-xl py-3 text-[15px] font-medium text-white">
          On to the next one
        </button>
      </div>
    </div>
  );
}

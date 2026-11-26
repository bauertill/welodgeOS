"use client";

import type { SiteVisitVerdict } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { dayKey } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import {
  glanceDefaults,
  glanceLabels,
  siteVisitVerdicts,
  verdictLabels,
  verdictStyles,
  type AreaRow,
  type GlanceRow,
  type IssueRow,
  type VideoRow,
} from "~/lib/site-visits";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * Site visit reports (doc §3.12, the owner 2026-11-26): laid out as Alex's
 * "Babak Apartment Visits" — a verdict per place, the side-by-side, room by
 * room, issues and needs with their videos — on each property visited, and
 * full size to read, print or save as a PDF.
 */

type Report = NonNullable<RouterOutputs["siteVisit"]["byId"]>;
type Unit = Report["units"][number];

export function VerdictBadge({ verdict, note }: { verdict: SiteVisitVerdict | null; note?: string | null }) {
  if (!verdict) return null;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase ${verdictStyles[verdict]}`}>
      {note?.trim() || verdictLabels[verdict]}
    </span>
  );
}

const who = (report: Report) => [formatDate(report.visitedOn), report.visitors ? `visited by ${report.visitors}` : null, report.guide ? `shown round by ${report.guide}` : null].filter(Boolean).join(" · ");

/** The report in full, in Alex's layout. */
export function SiteVisitReportView({ report }: { report: Report }) {
  const labels = glanceLabels(report.units);
  const head = "bg-[#5b4fc9] text-left text-[12px] font-semibold text-white";
  return (
    <article className="site-visit-report text-ink-900 space-y-8">
      <header className="border-b-4 border-[#cefa05] pb-4">
        <p className="text-ink-500 text-xs font-light">{[report.event?.name, "Site visit report", report.provider ? `Provider: ${report.provider.name}` : null].filter(Boolean).join(" · ")}</p>
        <h1 className="mt-1 text-[28px] leading-tight font-bold">{report.title}</h1>
        <p className="text-ink-500 mt-1 text-[13px] font-light">
          {who(report)}
          {report.author?.name ? ` · written up by ${report.author.name}` : ""}
        </p>
        {report.summary && <p className="mt-3 text-[14px] leading-relaxed font-light whitespace-pre-line">{report.summary}</p>}
      </header>

      {report.units.length > 1 && (
        <section>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`${head} w-56 px-3 py-2`}>Status</th>
                <th className={`${head} px-3 py-2`}>{report.units.length} places</th>
              </tr>
            </thead>
            <tbody>
              {report.units.map((unit) => (
                <tr key={unit.id} className="border-ink-200 border-b align-top">
                  <td className="px-3 py-2.5">
                    <VerdictBadge verdict={unit.verdict} note={unit.verdictNote} />
                  </td>
                  <td className="px-3 py-2.5 font-light">
                    <span className="font-medium">{unit.label}</span>
                    {unit.conclusion ? `: ${unit.conclusion}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {labels.length > 0 && report.units.length > 1 && (
        <section>
          <h2 className="mb-2 text-[20px] font-bold text-[#5b4fc9]">At a glance</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={`${head} px-3 py-2`} />
                  {report.units.map((unit) => (
                    <th key={unit.id} className={`${head} px-3 py-2`}>
                      {unit.label.split(" · ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.map((label) => (
                  <tr key={label} className="border-ink-200 border-b align-top">
                    <td className="px-3 py-2 font-medium">{label}</td>
                    {report.units.map((unit) => (
                      <td key={unit.id} className="px-3 py-2 font-light">
                        {unit.glance.find((row) => row.label === label)?.value ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-6">
        {report.units.length > 1 && <h2 className="text-[20px] font-bold text-[#5b4fc9]">The places</h2>}
        {report.units.map((unit, index) => (
          <UnitCard key={unit.id} unit={unit} number={report.units.length > 1 ? index + 1 : null} single={report.units.length === 1} />
        ))}
      </section>
    </article>
  );
}

function UnitCard({ unit, number, single }: { unit: Unit; number: number | null; single: boolean }) {
  return (
    <div className="border-ink-200 overflow-hidden rounded-lg border break-inside-avoid-page">
      <div className="flex items-center justify-between gap-3 bg-[#5b4fc9] px-3 py-2 text-white">
        <h3 className="text-[15px] font-semibold">
          {number ? `${number}. ` : ""}
          {unit.label}
          {unit.property && (
            <Link href={`/properties/${unit.property.id}`} className="ml-2 text-xs font-light text-white/80 underline print:hidden">
              open the property
            </Link>
          )}
        </h3>
        <VerdictBadge verdict={unit.verdict} note={unit.verdictNote} />
      </div>
      <div className="space-y-3 px-3 py-3">
        {unit.conclusion && <p className="text-[14px] leading-snug font-semibold">{unit.conclusion}</p>}
        {unit.notes && <p className="text-[13px] leading-relaxed font-light whitespace-pre-line">{unit.notes}</p>}
        {single && unit.glance.length > 0 && <Rows head={["", "At a glance"]} rows={unit.glance.map((row) => [row.label, row.value])} />}
        {unit.areas.length > 0 && <Rows head={["Area", "What we saw"]} rows={unit.areas.map((row) => [row.area, row.seen])} />}
        {unit.issues.length > 0 && (
          <div>
            <h4 className="mb-1 text-[12px] font-bold tracking-wide text-[#5b4fc9] uppercase">Issues and needs</h4>
            <ul className="list-disc space-y-1 pl-5 text-[13px] font-light">
              {unit.issues.map((issue, i) => (
                <li key={i}>
                  <span className="font-semibold">{issue.title}:</span> {issue.text}
                  {issue.videoUrl && (
                    <>
                      {" "}
                      (
                      <a href={issue.videoUrl} target="_blank" rel="noreferrer" className="text-[#5b4fc9] hover:underline">
                        video
                      </a>
                      {issue.at ? `, ${issue.at}` : ""})
                    </>
                  )}
                  {!issue.videoUrl && issue.at ? ` (${issue.at})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {unit.videos.length > 0 && (
        <p className="border-ink-200 text-ink-500 border-t px-3 py-2 text-xs font-light">
          Videos:{" "}
          {unit.videos.map((video, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <a href={video.url} target="_blank" rel="noreferrer" className="text-[#5b4fc9] hover:underline">
                {video.name}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function Rows({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th className="w-40 bg-[#5b4fc9] px-3 py-1.5 text-left text-[12px] font-semibold text-white">{head[0]}</th>
          <th className="bg-[#5b4fc9] px-3 py-1.5 text-left text-[12px] font-semibold text-white">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={i} className="border-ink-200 border-b align-top">
            <td className="px-3 py-2 font-medium">{label}</td>
            <td className="px-3 py-2 font-light whitespace-pre-line">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A property's (or provider's) reports: each as one line with its verdict here, opening full size. */
export function SiteVisitList({
  propertyId,
  providerId,
  eventId,
  propertyProviderId,
}: {
  propertyId?: string;
  providerId?: string;
  eventId?: string | null;
  /** The property's own chain or landlord, filled in on a new report. */
  propertyProviderId?: string | null;
}) {
  const reports = api.siteVisit.list.useQuery({ propertyId, providerId });
  const [adding, setAdding] = useState(false);
  const rows = reports.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-ink-500 text-[13px] font-light">
          {rows.length ? "Reports from visits, newest first." : reports.isLoading ? "Loading…" : "No site visit reports yet. Write one here, or have Claude post it through the connector."}
        </p>
        <button type="button" onClick={() => setAdding(true)} className="text-brand-700 shrink-0 text-[13px] font-medium hover:underline">
          + New site visit report
        </button>
      </div>
      {rows.map((report) => {
        const here = propertyId ? report.units.filter((unit) => unit.property?.id === propertyId) : report.units;
        return (
          <Link key={report.id} href={`/site-visits/${report.id}`} className="border-ink-200/70 hover:border-brand-300 block rounded-xl border bg-white p-4 transition-colors">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-ink-900 text-[14px] font-medium">{report.title}</p>
              <span className="text-ink-500 text-xs font-light">{formatDate(report.visitedOn)}</span>
            </div>
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              {[report.visitors ? `by ${report.visitors}` : null, report.units.length > 1 ? `${report.units.length} places` : null, report.provider?.name].filter(Boolean).join(" · ")}
            </p>
            {here.map((unit) => (
              <div key={unit.id} className="mt-2 flex items-start gap-2 text-[13px] font-light">
                <VerdictBadge verdict={unit.verdict} note={unit.verdictNote} />
                <span className="text-ink-900">{unit.conclusion ?? unit.label}</span>
              </div>
            ))}
            <span className="text-brand-700 mt-2 inline-block text-xs font-medium">Open the report →</span>
          </Link>
        );
      })}
      {adding && <SiteVisitEditor preset={{ propertyId, providerId: providerId ?? propertyProviderId ?? undefined, eventId }} onClose={() => setAdding(false)} />}
    </div>
  );
}

// --- Writing one ---------------------------------------------------------------

type UnitDraft = {
  propertyId: string;
  label: string;
  verdict: SiteVisitVerdict | "";
  verdictNote: string;
  conclusion: string;
  notes: string;
  glance: GlanceRow[];
  areas: AreaRow[];
  issues: IssueRow[];
  videos: VideoRow[];
};

const emptyUnit = (propertyId = "", label = ""): UnitDraft => ({
  propertyId,
  label,
  verdict: "",
  verdictNote: "",
  conclusion: "",
  notes: "",
  glance: glanceDefaults.map((label) => ({ label, value: "" })),
  areas: [
    { area: "Bedroom 1", seen: "" },
    { area: "Living", seen: "" },
    { area: "Kitchen", seen: "" },
  ],
  issues: [],
  videos: [],
});

const draftOf = (unit: Unit): UnitDraft => ({
  propertyId: unit.property?.id ?? "",
  label: unit.label,
  verdict: unit.verdict ?? "",
  verdictNote: unit.verdictNote ?? "",
  conclusion: unit.conclusion ?? "",
  notes: unit.notes ?? "",
  glance: unit.glance,
  areas: unit.areas,
  issues: unit.issues,
  videos: unit.videos,
});

export function SiteVisitEditor({
  report,
  preset,
  onClose,
}: {
  report?: Report;
  preset?: { propertyId?: string; providerId?: string; eventId?: string | null };
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const properties = api.property.list.useQuery({});
  const providers = api.provider.list.useQuery();
  const events = api.event.list.useQuery();
  const presetName = properties.data?.find((p) => p.id === preset?.propertyId)?.name ?? "";
  const [title, setTitle] = useState(report?.title ?? "");
  const [visitedOn, setVisitedOn] = useState(report ? dayKey(report.visitedOn) : dayKey(new Date()));
  const [visitors, setVisitors] = useState(report?.visitors ?? "");
  const [guide, setGuide] = useState(report?.guide ?? "");
  const [summary, setSummary] = useState(report?.summary ?? "");
  const [eventId, setEventId] = useState(report?.event?.id ?? preset?.eventId ?? "");
  const [providerId, setProviderId] = useState(report?.provider?.id ?? preset?.providerId ?? "");
  const [units, setUnits] = useState<UnitDraft[]>(report ? report.units.map(draftOf) : [emptyUnit(preset?.propertyId ?? "")]);
  const done = (saved: { id: string }) => {
    void utils.siteVisit.invalidate();
    void utils.scouting.listForEvent.invalidate();
    void utils.audit.invalidate();
    onClose();
    if (report) router.refresh();
    else router.push(`/site-visits/${saved.id}`);
  };
  const create = api.siteVisit.create.useMutation({ onSuccess: done });
  const update = api.siteVisit.update.useMutation({ onSuccess: done });
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const setUnit = (index: number, change: Partial<UnitDraft>) => setUnits(units.map((unit, i) => (i === index ? { ...unit, ...change } : unit)));
  const propertyName = (id: string) => properties.data?.find((p) => p.id === id)?.name ?? "";

  const save = () => {
    const data = {
      title,
      visitedOn,
      visitors,
      guide,
      summary,
      eventId: eventId || null,
      providerId: providerId || null,
      units: units.map((unit) => ({
        propertyId: unit.propertyId || null,
        label: unit.label.trim() || propertyName(unit.propertyId) || (unit.propertyId === preset?.propertyId ? presetName : ""),
        verdict: unit.verdict || null,
        verdictNote: unit.verdictNote,
        conclusion: unit.conclusion,
        notes: unit.notes,
        glance: unit.glance.filter((row) => row.label.trim() && row.value.trim()),
        areas: unit.areas.filter((row) => row.area.trim() && row.seen.trim()),
        issues: unit.issues.filter((row) => row.title.trim()),
        videos: unit.videos.filter((row) => row.name.trim() && row.url.trim()),
      })),
    };
    if (report) update.mutate({ id: report.id, ...data });
    else create.mutate(data);
  };

  return (
    <Popup title={report ? "Edit site visit report" : "New site visit report"} subtitle="One visit, one or several places — each with its verdict, what you saw, the issues and the videos." onClose={onClose}>
      <form
        className="space-y-5 rounded-xl bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Babak Apartment Visits" autoFocus />
          </Field>
          <Field label="Visited on">
            <Input type="date" value={visitedOn} onChange={(e) => setVisitedOn(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who went">
            <Input value={visitors} onChange={(e) => setVisitors(e.target.value)} placeholder="Alex Lingois and Eric" />
          </Field>
          <Field label="Who showed you round — optional">
            <Input value={guide} onChange={(e) => setGuide(e.target.value)} placeholder="Minerva" />
          </Field>
          <Field label="Event — optional">
            <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">—</option>
              {events.data?.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Provider or landlord — optional">
            <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">—</option>
              {providers.data?.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Summary — optional">
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="What you visited, with whom, and what they are best for." />
        </Field>

        {units.map((unit, index) => (
          <fieldset key={index} className="border-ink-200 space-y-4 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <legend className="text-ink-900 text-[14px] font-semibold">Place {index + 1}</legend>
              {units.length > 1 && (
                <button type="button" onClick={() => setUnits(units.filter((_, i) => i !== index))} className="text-xs text-[#c03654] hover:underline">
                  Remove this place
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="The property">
                <Combobox
                  value={unit.propertyId}
                  onChange={(id) => setUnit(index, { propertyId: id, label: unit.label || propertyName(id) })}
                  placeholder="Choose the property…"
                  options={(properties.data ?? []).map((property) => ({ id: property.id, label: property.name, detail: property.city }))}
                />
              </Field>
              <Field label="Heading">
                <Input value={unit.label} onChange={(e) => setUnit(index, { label: e.target.value })} placeholder="Unit 209 · 1540 6th St (Livorno)" />
              </Field>
              <Field label="Verdict">
                <Select value={unit.verdict} onChange={(e) => setUnit(index, { verdict: e.target.value as SiteVisitVerdict | "" })}>
                  <option value="">—</option>
                  {siteVisitVerdicts.map((verdict) => (
                    <option key={verdict} value={verdict}>
                      {verdictLabels[verdict]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Badge in your words — optional">
                <Input value={unit.verdictNote} onChange={(e) => setUnit(index, { verdictNote: e.target.value })} placeholder="Stronger option out of the 3" />
              </Field>
            </div>
            <Field label="In a line or two">
              <Textarea value={unit.conclusion} onChange={(e) => setUnit(index, { conclusion: e.target.value })} rows={2} placeholder="Bright, modern, balcony and in-unit laundry. Good for staff once the walls are repainted." />
            </Field>
            <PairRows
              title="At a glance"
              rows={unit.glance.map((row) => [row.label, row.value])}
              onChange={(rows) => setUnit(index, { glance: rows.map(([label, value]) => ({ label, value })) })}
              placeholders={["Sleeps", "—"]}
            />
            <PairRows
              title="Room by room"
              rows={unit.areas.map((row) => [row.area, row.seen])}
              onChange={(rows) => setUnit(index, { areas: rows.map(([area, seen]) => ({ area, seen })) })}
              placeholders={["Bedroom 1", "2 twin beds, private bathroom with soaking tub…"]}
              long
            />
            <IssueRows issues={unit.issues} onChange={(issues) => setUnit(index, { issues })} />
            <PairRows
              title="Videos"
              rows={unit.videos.map((row) => [row.name, row.url])}
              onChange={(rows) => setUnit(index, { videos: rows.map(([name, url]) => ({ name, url })) })}
              placeholders={["Babak apartment 209", "https://www.dropbox.com/…"]}
            />
            <Field label="More in words — optional">
              <Textarea value={unit.notes} onChange={(e) => setUnit(index, { notes: e.target.value })} rows={2} placeholder="What could be seen, if a walk-through was not possible." />
            </Field>
          </fieldset>
        ))}
        <button type="button" onClick={() => setUnits([...units, emptyUnit()])} className="text-brand-700 text-[13px] font-medium hover:underline">
          + Add another place visited
        </button>

        <FormError message={error ? friendlyError(error) : null} />
        <Button type="submit" disabled={!title.trim() || pending || units.some((unit) => !unit.label.trim() && !unit.propertyId)}>
          {pending ? "Saving…" : report ? "Save the report" : "Post the report"}
        </Button>
      </form>
    </Popup>
  );
}

function PairRows({
  title,
  rows,
  onChange,
  placeholders,
  long,
}: {
  title: string;
  rows: [string, string][];
  onChange: (rows: [string, string][]) => void;
  placeholders: [string, string];
  long?: boolean;
}) {
  const set = (index: number, part: 0 | 1, value: string) => onChange(rows.map((row, i) => (i === index ? ((part === 0 ? [value, row[1]] : [row[0], value]) as [string, string]) : row)));
  return (
    <div>
      <span className="text-ink-700 mb-1 block text-[13px] font-medium">{title}</span>
      <div className="space-y-1.5">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[10rem_1fr_auto] items-start gap-2">
            <Input value={row[0]} onChange={(e) => set(index, 0, e.target.value)} placeholder={placeholders[0]} aria-label={`${title} — name`} />
            {long ? (
              <Textarea value={row[1]} onChange={(e) => set(index, 1, e.target.value)} rows={2} placeholder={placeholders[1]} aria-label={`${title} — text`} />
            ) : (
              <Input value={row[1]} onChange={(e) => set(index, 1, e.target.value)} placeholder={placeholders[1]} aria-label={`${title} — text`} />
            )}
            <button type="button" onClick={() => onChange(rows.filter((_, i) => i !== index))} className="text-ink-400 py-2 text-lg leading-none hover:text-[#c03654]" aria-label="Remove the row">
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...rows, ["", ""]])} className="text-brand-700 mt-1 text-xs font-medium hover:underline">
        + Add a row
      </button>
    </div>
  );
}

function IssueRows({ issues, onChange }: { issues: IssueRow[]; onChange: (issues: IssueRow[]) => void }) {
  const set = (index: number, change: Partial<IssueRow>) => onChange(issues.map((issue, i) => (i === index ? { ...issue, ...change } : issue)));
  return (
    <div>
      <span className="text-ink-700 mb-1 block text-[13px] font-medium">Issues and needs</span>
      <div className="space-y-2">
        {issues.map((issue, index) => (
          <div key={index} className="grid grid-cols-[10rem_1fr_auto] items-start gap-2">
            <Input value={issue.title} onChange={(e) => set(index, { title: e.target.value })} placeholder="Walls" aria-label="Issue" />
            <div className="space-y-1.5">
              <Textarea value={issue.text} onChange={(e) => set(index, { text: e.target.value })} rows={2} placeholder="Need repainting throughout, not just touch-ups." aria-label="What is wrong" />
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Input value={issue.videoUrl ?? ""} onChange={(e) => set(index, { videoUrl: e.target.value })} placeholder="Video link — optional" aria-label="Video link" />
                <Input value={issue.at ?? ""} onChange={(e) => set(index, { at: e.target.value })} placeholder="0:52" aria-label="Time in the video" />
              </div>
            </div>
            <button type="button" onClick={() => onChange(issues.filter((_, i) => i !== index))} className="text-ink-400 py-2 text-lg leading-none hover:text-[#c03654]" aria-label="Remove the issue">
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...issues, { title: "", text: "" }])} className="text-brand-700 mt-1 text-xs font-medium hover:underline">
        + Add an issue
      </button>
    </div>
  );
}

/** The report page's buttons: edit, print or save as PDF, delete. */
export function SiteVisitActions({ report }: { report: Report }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const remove = api.siteVisit.remove.useMutation({ onSuccess: () => router.push(report.units[0]?.property ? `/properties/${report.units[0].property.id}` : "/events") });
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" onClick={() => window.print()} className="border-ink-200 text-ink-700 hover:bg-ink-50 rounded-full border bg-white px-4 py-2 text-[13px] font-light">
        Print or save as PDF
      </button>
      <button type="button" onClick={() => setEditing(true)} className="border-ink-200 text-ink-700 hover:bg-ink-50 rounded-full border bg-white px-4 py-2 text-[13px] font-light">
        Edit
      </button>
      <button
        type="button"
        onClick={() => window.confirm(`Delete the report "${report.title}"?`) && remove.mutate({ id: report.id })}
        className="rounded-full border border-[#f3c3cf] bg-white px-4 py-2 text-[13px] font-light text-[#c03654] hover:bg-[#fdf0f3]"
      >
        Delete
      </button>
      {editing && <SiteVisitEditor report={report} onClose={() => setEditing(false)} />}
    </div>
  );
}

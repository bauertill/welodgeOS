"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

import { Button, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { PrintButton } from "~/app/_components/print-button";
import { agreementGaps, readAgreement } from "~/lib/agreement";
import { dayKey, today } from "~/lib/dates";
import { formatDate, formatMomentInWords } from "~/lib/format";
import { api } from "~/trpc/react";

/** **bold**, and [missing: …] highlighted so a gap is seen before the agreement goes. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[missing: [^\]]+\])/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") ? (
          <strong key={index} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("[missing: ") ? (
          <mark key={index} className="rounded bg-[#fde68a] px-1 text-[#7a5410] print:bg-[#fde68a]">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** The agreement drawn as a document — on screen as on paper. */
export function AgreementDocument({ text }: { text: string }) {
  const blocks = readAgreement(text);
  return (
    <article className="text-ink-900 mx-auto max-w-3xl rounded-2xl bg-white px-12 py-12 text-[13px] leading-relaxed shadow-[0_1px_3px_rgba(0,0,0,0.06)] print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "title":
            return (
              <h1 key={index} className="mb-6 text-center text-2xl font-semibold tracking-wide">
                {block.text}
              </h1>
            );
          case "clause":
            return (
              <h2 key={index} className="mt-7 mb-2 text-[14px] font-semibold tracking-wide break-after-avoid">
                {block.text}
              </h2>
            );
          case "schedule":
            return (
              <h2 key={index} className="border-ink-200 mt-12 border-t pt-8 text-center text-lg font-semibold tracking-wide print:mt-0 print:break-before-page print:border-0 print:pt-0">
                {block.text}
              </h2>
            );
          case "subheading":
            return (
              <h3 key={index} className="mt-1 mb-4 text-center text-[13px] font-semibold tracking-wide">
                {block.text}
              </h3>
            );
          case "numbered":
            return (
              <div key={index} className="mb-1.5 grid grid-cols-[3.5rem_1fr] gap-2" style={{ marginLeft: `${Math.max(0, block.depth - 2) * 3.5}rem` }}>
                <span className={block.depth === 1 ? "font-semibold" : "text-ink-700"}>{block.number}</span>
                <span className={block.depth === 1 ? "font-semibold" : ""}>
                  <Inline text={block.text} />
                </span>
              </div>
            );
          case "bullet":
            return (
              <p key={index} className="mb-1 ml-6 list-item list-disc">
                <Inline text={block.text} />
              </p>
            );
          case "table":
            return (
              <table key={index} className="my-3 w-full table-fixed border-collapse text-[11px] break-words">
                <thead>
                  <tr>
                    {block.rows[0]!.map((cell, i) => (
                      <th key={i} className="border-ink-300 border-b px-1.5 py-1.5 text-left font-semibold">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.slice(1).map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, i) => (
                        <td key={i} className="border-ink-200 border-b px-1.5 py-1.5 align-top">
                          <Inline text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "sign":
            return (
              <div key={index} className="mt-12 grid grid-cols-[1fr_12rem] gap-10 break-inside-avoid">
                <div>
                  <div className="border-ink-900 mb-1.5 border-b" style={{ height: "2.5rem" }} />
                  <p>
                    <Inline text={block.who} />
                  </p>
                  <p className="text-ink-700">
                    <Inline text={block.how} />
                  </p>
                </div>
                <div>
                  <div className="border-ink-900 mb-1.5 border-b" style={{ height: "2.5rem" }} />
                  <p>DATE</p>
                </div>
              </div>
            );
          case "contents":
            return (
              <div key={index} className="my-8 print:break-after-page">
                <h2 className="mb-2 text-[14px] font-semibold tracking-wide">CONTENTS</h2>
                <ol className="columns-2 gap-8 text-[12px]">
                  {block.clauses.map((clause) => (
                    <li key={clause} className="py-0.5">
                      {clause}
                    </li>
                  ))}
                </ol>
              </div>
            );
          case "paragraph":
            return (
              <p key={index} className="mb-2">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </article>
  );
}

type ReviewData = {
  backHref: string;
  backLabel: string;
  title: string;
  /** "client" or "hotel" — whose agreement it is, in the page's words. */
  party: "client" | "hotel";
  text: string;
  edited: boolean;
  sentOn: Date | null;
  templateHref: string;
  templateLabel: string;
  /** Where gaps are filled, in words. */
  fillFrom: string;
  /** Said above the document, when there is something to warn of. */
  notice?: string;
};

/**
 * Reviewing an agreement before it goes (doc §4.11) — the client's, or ours
 * with a hotel: what is still missing, the wording changed for this one if
 * needed, then saved as a PDF and sent by DocuSign — and marked as sent here.
 */
function ReviewShell({
  data,
  onSave,
  saving,
  saveError,
  onMarkSent,
  marking,
}: {
  data: ReviewData;
  onSave: (text: string | null, done: () => void) => void;
  saving: boolean;
  saveError: string | null;
  onMarkSent: (sentOn: string | null, done: () => void) => void;
  marking: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const gaps = agreementGaps(data.text);
  const them = data.party === "client" ? "client" : "hotel";

  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-3xl space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={data.backHref} className="text-ink-500 text-[13px] hover:underline">
              ← {data.backLabel}
            </Link>
            <h1 className="text-ink-900 text-xl font-semibold">{data.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-medium hover:underline">
              Edit the wording for this {them}
            </button>
            <PrintButton />
          </div>
        </div>

        {gaps.length > 0 ? (
          <div className="rounded-xl border border-[#f0d9a8] bg-[#fdf6e7] px-5 py-3 text-[13px] text-[#7a5410]">
            <p className="font-semibold">Still missing — highlighted below:</p>
            <ul className="mt-1 list-disc pl-5">
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">
              Fill them in on {data.fillFrom}
              {data.edited ? ", then go back to the template's wording to refill," : ""} — or type them in with “Edit the wording”.
            </p>
          </div>
        ) : (
          <p className="rounded-xl bg-[#e3f8ee] px-5 py-3 text-[13px] text-[#0a7a47]">✓ Nothing missing. Check it reads right, save it as a PDF and send it by DocuSign.</p>
        )}

        {data.notice && <p className="rounded-xl border border-[#f0d9a8] bg-[#fdf6e7] px-5 py-3 text-[13px] text-[#7a5410]">{data.notice}</p>}

        {data.edited && (
          <p className="bg-brand-50 text-brand-800 rounded-xl px-5 py-3 text-[13px] font-light">
            The wording was changed for this {them}. Later changes to what it is filled from are not filled in —{" "}
            <button type="button" onClick={() => setEditing(true)} className="font-medium underline">
              go back to the template&rsquo;s wording
            </button>{" "}
            to refill.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-5 py-3 text-[13px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {data.sentOn ? (
            <>
              <span className="text-[#0a7a47]">
                ✓ Sent to the {them} on {formatDate(data.sentOn)}
              </span>
              <button type="button" onClick={() => onMarkSent(null, () => undefined)} className="text-ink-500 hover:underline">
                Not sent after all
              </button>
            </>
          ) : sending !== null ? (
            <>
              Sent by DocuSign on
              <Input type="date" value={sending} onChange={(e) => setSending(e.target.value)} aria-label="Sent on" className="w-40 px-2" />
              <Button type="button" onClick={() => onMarkSent(sending, () => setSending(null))} disabled={!sending || marking}>
                Save
              </Button>
              <button type="button" onClick={() => setSending(null)} className="text-ink-500 hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="text-ink-500 font-light">Not sent yet. Once it has gone by DocuSign:</span>
              <button type="button" onClick={() => setSending(dayKey(today()))} className="text-brand-700 font-medium hover:underline">
                Mark as sent
              </button>
            </>
          )}
          <Link href={data.templateHref} className="text-ink-500 ml-auto text-xs hover:underline">
            {data.templateLabel} →
          </Link>
        </div>
      </div>

      <AgreementDocument text={data.text} />

      {editing && (
        <Popup
          title={`The wording, for this ${them}`}
          subtitle="Changes here are for this agreement only. # starts a clause, ## a schedule; numbers at the start of a line number a paragraph."
          onClose={() => setEditing(false)}
        >
          <EditWording text={data.text} edited={data.edited} them={them} saving={saving} error={saveError} onSave={(text) => onSave(text, () => setEditing(false))} />
        </Popup>
      )}
    </div>
  );
}

function EditWording({
  text,
  edited,
  them,
  saving,
  error,
  onSave,
}: {
  text: string;
  edited: boolean;
  them: string;
  saving: boolean;
  error: string | null;
  onSave: (text: string | null) => void;
}) {
  const [draft, setDraft] = useState(text);
  return (
    <div className="space-y-3">
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={28} className="font-mono text-[12px]" aria-label="Agreement wording" />
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={() => onSave(draft)} disabled={saving}>
          Save for this {them}
        </Button>
        {edited && (
          <button type="button" onClick={() => onSave(null)} className="text-[13px] text-[#c03654] hover:underline">
            Back to the template&rsquo;s wording, filled afresh
          </button>
        )}
      </div>
    </div>
  );
}

/** The client's agreement for an offer (doc §4.11). */
export function AgreementReview({ offerId }: { offerId: string }) {
  const utils = api.useUtils();
  const agreement = api.offer.agreement.useQuery({ id: offerId });
  const save = api.offer.saveAgreement.useMutation({ onSuccess: () => void utils.offer.invalidate() });
  const markSent = api.offer.markSent.useMutation({ onSuccess: () => void utils.offer.invalidate() });
  if (!agreement.data) return <p className="text-ink-500 text-sm font-light">{agreement.error ? friendlyError(agreement.error) : "Loading…"}</p>;
  const data = agreement.data;
  return (
    <ReviewShell
      data={{
        backHref: `/sales/${data.salesRequestId}`,
        backLabel: `${data.clientName} · ${data.eventName}`,
        title: data.amends ? "Addendum" : "Agreement",
        party: "client",
        // No addendum wording is in the system yet: say so rather than pass the framework off as one (doc §4.11).
        notice: data.amends
          ? `This is an addendum to ${data.amends}. The system only has the framework agreement's wording, shown below — change it for this client with “Edit the wording”, or write the addendum outside and use Mark as sent.`
          : undefined,
        text: data.text,
        edited: data.edited,
        sentOn: data.sentOn,
        templateHref: "/agreement-template",
        templateLabel: "The framework wording, for every client",
        fillFrom: "the request (contracting details) or the offer",
      }}
      onSave={(text, done) => save.mutate({ id: offerId, text }, { onSuccess: done })}
      saving={save.isPending}
      saveError={save.error ? friendlyError(save.error) : null}
      onMarkSent={(sentOn, done) => markSent.mutate({ id: offerId, sentOn }, { onSuccess: done })}
      marking={markSent.isPending}
    />
  );
}

/** Our agreement with a hotel, for a US event (doc §4.11). */
export function HotelAgreementReview({ contractId }: { contractId: string }) {
  const utils = api.useUtils();
  const agreement = api.acquire.hotelAgreement.useQuery({ contractId });
  const save = api.acquire.saveHotelAgreement.useMutation({ onSuccess: () => void utils.acquire.invalidate() });
  const markSent = api.acquire.markHotelAgreementSent.useMutation({ onSuccess: () => void utils.acquire.invalidate() });
  if (!agreement.data) return <p className="text-ink-500 text-sm font-light">{agreement.error ? friendlyError(agreement.error) : "Loading…"}</p>;
  const data = agreement.data;
  if (!data.inUS) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl bg-white px-6 py-5 text-[14px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <Link href={data.backHref} className="text-ink-500 text-[13px] hover:underline">
          ← {data.backLabel}
        </Link>
        <p className="text-ink-900 mt-2">Our hotel agreement is only for events in the United States so far — {data.eventName} is not.</p>
        <p className="text-ink-500 mt-1 text-[13px] font-light">Use the hotel&rsquo;s agreement, or our Word version, for now.</p>
      </div>
    );
  }
  return (
    <ReviewShell
      data={{
        backHref: data.backHref,
        backLabel: `${data.backLabel} · ${data.eventName}`,
        title: `Our agreement with ${data.title}`,
        party: "hotel",
        text: data.text,
        edited: data.edited,
        sentOn: data.sentOn,
        templateHref: "/agreement-template?kind=hotel-us",
        templateLabel: "Our hotel agreement's wording, for every hotel",
        fillFrom: "the hotel's contracting details, its quote or its contract",
      }}
      onSave={(text, done) => save.mutate({ id: contractId, text }, { onSuccess: done })}
      saving={save.isPending}
      saveError={save.error ? friendlyError(save.error) : null}
      onMarkSent={(sentOn, done) => markSent.mutate({ id: contractId, sentOn }, { onSuccess: done })}
      marking={markSent.isPending}
    />
  );
}

const clientFields: [string, string][] = [
  ["{{welodge.represented}}", "Who signs for We Lodge — Volkhard Bauer for a US event, else Raphael Dornier"],
  ["{{welodge.signature}}", "Their signature line"],
  ["{{client.name}}", "The client's trade name, from their contracting details"],
  ["{{client.address}}", "Their company address"],
  ["{{client.represented}}", "\"herein represented by …\" — who signs, with their titles"],
  ["{{client.signatures}}", "A signature line for each of their signatories"],
  ["{{currency}}", "The offer's currency, like USD"],
  ["{{currency.definition}}", "What that currency is, for the definitions"],
  ["{{bank}}", "The account to pay into, for the offer's currency"],
  ["{{payments:4.2}}", "The payment schedule, numbered under 4.2"],
  ["{{event.dates}}", "The event and its dates"],
  ["{{schedule2}}", "The cost analysis: the hotels, inclusions, payment terms, cancellation, conditions, validity"],
  ["{{schedule2.1}}", "The table of rooms, dates and rates"],
];

const hotelFields: [string, string][] = [
  ["{{date}}", "The day the agreement is drawn up"],
  ["{{hotel.party}}", "The hotel's company, its state and type, and its address"],
  ["{{hotel.name}}", "The hotel's name"],
  ["{{hotel.registration}}", "Its registration number"],
  ["{{hotel.notice}}", "Where notices go — the hotel, and a copy to its group"],
  ["{{hotel.signature}}", "The hotel's signature line — who signs and their title"],
  ["{{welodge.signature}}", "Our signature line — Volkhard Bauer, CEO"],
  ["{{event.name}}", "The event's name"],
  ["{{event.dates}}", "The event and its dates"],
  ["{{total}}", "The contract's total, in dollars"],
  ["{{payments:5.3}}", "The payment schedule, in dollars and per cent, numbered under 5.3"],
  ["{{parking}}", "Clause 11, parking — to fill in for each hotel"],
  ["{{inclusions}}", "What the quote's rate includes"],
  ["{{cancellation}}", "The cancellation fees, date range by date range"],
  ["{{schedule2.1}}", "The table of rooms, dates and rates from the quote"],
];

/** An agreement's wording, for every client — or every hotel at a US event (doc §4.11). */
export function TemplateEditor({ kind }: { kind: "framework" | "hotel-us" }) {
  const utils = api.useUtils();
  const template = api.offer.template.useQuery({ kind });
  const fieldHelp = kind === "framework" ? clientFields : hotelFields;
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = api.offer.saveTemplate.useMutation({
    onSuccess: () => {
      setDraft(null);
      setSaved(true);
      void utils.offer.invalidate();
    },
  });
  if (!template.data) return <p className="text-ink-500 text-sm font-light">{template.error ? friendlyError(template.error) : "Loading…"}</p>;
  const text = draft ?? template.data.text;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-ink-900 text-xl font-semibold">{kind === "framework" ? "The framework agreement" : "Our hotel agreement — US events"}</h1>
        <p className="text-ink-500 mt-1 text-[13px] font-light">
          The wording every {kind === "framework" ? "client" : "hotel"}&rsquo;s agreement is filled from. A change here reaches every agreement drawn up from
          now on — not one already changed for its {kind === "framework" ? "client" : "hotel"}.{" "}
          {template.data.changed
            ? `Last changed ${formatMomentInWords(template.data.changed.at)}${template.data.changed.by ? ` by ${template.data.changed.by}` : ""}.`
            : kind === "framework"
              ? "This is the original wording, from the BBC agreement for SOL28."
              : "This is the original wording, from the Aimbridge agreement for the Fairfield Inn & Suites El Segundo (SOL28)."}
        </p>
      </div>
      {saved && <p className="rounded-xl bg-[#e3f8ee] px-5 py-3 text-[13px] text-[#0a7a47]">Saved.</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Textarea value={text} onChange={(e) => (setDraft(e.target.value), setSaved(false))} rows={36} className="font-mono text-[12px]" aria-label="Framework wording" />
        <aside className="space-y-3 text-[12px]">
          <div className="rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-ink-900 mb-1.5 font-semibold">Filled in for each {kind === "framework" ? "client" : "hotel"}</p>
            <dl className="space-y-1.5">
              {fieldHelp.map(([field, meaning]) => (
                <div key={field}>
                  <dt className="text-brand-700 font-mono">{field}</dt>
                  <dd className="text-ink-500 font-light">{meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="text-ink-500 rounded-xl bg-white px-4 py-3 font-light shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-ink-900 mb-1 font-semibold">How lines are drawn</p>
            <p># a clause · ## a schedule · ### a heading in it · 4.2 at the start numbers a paragraph · @sign a signature line · **bold**</p>
          </div>
        </aside>
      </div>
      <FormError message={save.error ? friendlyError(save.error) : null} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" onClick={() => save.mutate({ kind, text })} disabled={save.isPending || draft === null}>
          Save the wording
        </Button>
        {template.data.changed && (
          <button type="button" onClick={() => save.mutate({ kind, text: null })} className="text-[13px] text-[#c03654] hover:underline">
            Back to the original wording
          </button>
        )}
      </div>
    </div>
  );
}

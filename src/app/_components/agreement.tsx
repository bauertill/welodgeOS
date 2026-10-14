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

/**
 * Reviewing an offer's agreement before it goes (doc §4.11): what is still
 * missing, the wording changed for this client if needed, then saved as a PDF
 * and sent by DocuSign — and marked as sent here.
 */
export function AgreementReview({ offerId }: { offerId: string }) {
  const utils = api.useUtils();
  const agreement = api.offer.agreement.useQuery({ id: offerId });
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const refresh = () => {
    void utils.offer.invalidate();
  };
  const markSent = api.offer.markSent.useMutation({ onSuccess: () => (setSending(null), refresh()) });

  if (!agreement.data) return <p className="text-ink-500 text-sm font-light">{agreement.error ? friendlyError(agreement.error) : "Loading…"}</p>;
  const data = agreement.data;
  const gaps = agreementGaps(data.text);

  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-3xl space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/sales/${data.salesRequestId}`} className="text-ink-500 text-[13px] hover:underline">
              ← {data.clientName} · {data.eventName}
            </Link>
            <h1 className="text-ink-900 text-xl font-semibold">Agreement</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-medium hover:underline">
              Edit the wording for this client
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
              Fill them in on the request (contracting details) or the offer{data.edited ? ", then go back to the framework's wording to refill," : ""} — or type them in with “Edit the wording”.
            </p>
          </div>
        ) : (
          <p className="rounded-xl bg-[#e3f8ee] px-5 py-3 text-[13px] text-[#0a7a47]">✓ Nothing missing. Check it reads right, save it as a PDF and send it by DocuSign.</p>
        )}

        {data.edited && (
          <p className="bg-brand-50 text-brand-800 rounded-xl px-5 py-3 text-[13px] font-light">
            The wording was changed for this client. Changes to the offer or the contracting details since are not filled in —{" "}
            <button type="button" onClick={() => setEditing(true)} className="font-medium underline">
              go back to the framework&rsquo;s wording
            </button>{" "}
            to refill.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-5 py-3 text-[13px] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {data.sentOn ? (
            <>
              <span className="text-[#0a7a47]">✓ Sent to the client on {formatDate(data.sentOn)}</span>
              <button type="button" onClick={() => markSent.mutate({ id: offerId, sentOn: null })} className="text-ink-500 hover:underline">
                Not sent after all
              </button>
            </>
          ) : sending !== null ? (
            <>
              Sent by DocuSign on
              <Input type="date" value={sending} onChange={(e) => setSending(e.target.value)} aria-label="Sent on" className="w-40 px-2" />
              <Button type="button" onClick={() => markSent.mutate({ id: offerId, sentOn: sending })} disabled={!sending || markSent.isPending}>
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
          <Link href="/agreement-template" className="text-ink-500 ml-auto text-xs hover:underline">
            The framework wording, for every client →
          </Link>
        </div>
      </div>

      <AgreementDocument text={data.text} />

      {editing && <EditWording offerId={offerId} text={data.text} edited={data.edited} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditWording({ offerId, text, edited, onClose }: { offerId: string; text: string; edited: boolean; onClose: () => void }) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState(text);
  const save = api.offer.saveAgreement.useMutation({
    onSuccess: () => {
      void utils.offer.agreement.invalidate();
      onClose();
    },
  });
  return (
    <Popup title="The wording, for this client" subtitle="Changes here are for this agreement only. # starts a clause, ## a schedule; numbers at the start of a line number a paragraph." onClose={onClose}>
      <div className="space-y-3">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={28} className="font-mono text-[12px]" aria-label="Agreement wording" />
        <FormError message={save.error ? friendlyError(save.error) : null} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" onClick={() => save.mutate({ id: offerId, text: draft })} disabled={save.isPending}>
            Save for this client
          </Button>
          {edited && (
            <button type="button" onClick={() => save.mutate({ id: offerId, text: null })} className="text-[13px] text-[#c03654] hover:underline">
              Back to the framework&rsquo;s wording, filled afresh
            </button>
          )}
        </div>
      </div>
    </Popup>
  );
}

const fieldHelp: [string, string][] = [
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

/** The framework agreement's wording, for every client (doc §4.11). */
export function TemplateEditor() {
  const utils = api.useUtils();
  const template = api.offer.template.useQuery();
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
        <h1 className="text-ink-900 text-xl font-semibold">The framework agreement</h1>
        <p className="text-ink-500 mt-1 text-[13px] font-light">
          The wording every client&rsquo;s agreement is filled from. A change here reaches every agreement drawn up from now on — not one already
          changed for its client.{" "}
          {template.data.changed
            ? `Last changed ${formatMomentInWords(template.data.changed.at)}${template.data.changed.by ? ` by ${template.data.changed.by}` : ""}.`
            : "This is the original wording, from the BBC agreement for SOL28."}
        </p>
      </div>
      {saved && <p className="rounded-xl bg-[#e3f8ee] px-5 py-3 text-[13px] text-[#0a7a47]">Saved.</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Textarea value={text} onChange={(e) => (setDraft(e.target.value), setSaved(false))} rows={36} className="font-mono text-[12px]" aria-label="Framework wording" />
        <aside className="space-y-3 text-[12px]">
          <div className="rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-ink-900 mb-1.5 font-semibold">Filled in for each client</p>
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
        <Button type="button" onClick={() => save.mutate({ text })} disabled={save.isPending || draft === null}>
          Save the wording
        </Button>
        {template.data.changed && (
          <button type="button" onClick={() => save.mutate({ text: null })} className="text-[13px] text-[#c03654] hover:underline">
            Back to the original wording
          </button>
        )}
      </div>
    </div>
  );
}

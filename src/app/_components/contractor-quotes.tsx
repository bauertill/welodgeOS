"use client";

import type { QuotationStatus } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FileField } from "~/app/_components/file-field";
import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { InUsd } from "~/app/_components/in-usd";
import { Popup } from "~/app/_components/popup";
import { linkKind } from "~/app/_components/task-files";
import { currencyOptions } from "~/lib/currency";
import { isStoredLink, storedName } from "~/lib/file-link";
import { contractHref } from "~/lib/finance";
import { dayKey } from "~/lib/dates";
import { formatDate, formatMoney, formatMomentInWords } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * A contractor's quotes and files (doc §3.11, the owner 2026-11-26: "on the
 * contractors tab we should be able to upload a file, add a quote etc").
 */

type Quote = RouterOutputs["contractor"]["quotes"][number];
type LineDraft = { quantity: string; description: string; unit: string; price: string };

const statusLabels: Record<QuotationStatus, string> = { RECEIVED: "Received", ACCEPTED: "Accepted", DECLINED: "Declined" };
const statusStyles: Record<QuotationStatus, string> = {
  RECEIVED: "bg-[#e6f0fb] text-[#1d5fa8]",
  ACCEPTED: "bg-[#e3f8ee] text-[#0a7a47]",
  DECLINED: "bg-ink-50 text-ink-500",
};

const parseMoney = (value: string) => {
  if (!value.trim()) return null;
  const n = Number(value.replace(/[’'\s,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};

export function ContractorQuotes({ contractorId }: { contractorId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const quotes = api.contractor.quotes.useQuery({ contractorId });
  const refresh = () => {
    void utils.contractor.quotes.invalidate({ contractorId });
    void utils.audit.invalidate();
  };
  const setStatus = api.contractor.setQuoteStatus.useMutation({ onSuccess: refresh });
  const remove = api.contractor.removeQuote.useMutation({ onSuccess: refresh });
  const accept = api.contractor.acceptQuote.useMutation({
    onSuccess: (contract) => {
      refresh();
      void utils.finance.invalidate();
      router.push(contractHref(contract.eventId, contract.id));
    },
  });
  const [editing, setEditing] = useState<Quote | "new" | null>(null);
  const rows = quotes.data ?? [];
  const error = setStatus.error ?? remove.error ?? accept.error;

  return (
    <div>
      {rows.length === 0 && !quotes.isLoading && <p className="text-ink-500 text-[13px] font-light">No quotes yet.</p>}
      {rows.length > 0 && (
        <ul className="divide-ink-200/60 divide-y">
          {rows.map((quote) => (
            <li key={quote.id} className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 ${quote.status === "DECLINED" ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-ink-900 text-[14px] font-medium">
                  {quote.title}
                  <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-medium ${statusStyles[quote.status]}`}>{statusLabels[quote.status]}</span>
                </p>
                <p className="text-ink-500 mt-0.5 text-xs font-light">
                  {[quote.receivedOn ? `received ${formatDate(quote.receivedOn)}` : null, quote.validUntil ? `valid until ${formatDate(quote.validUntil)}` : null, quote.createdBy?.name ? `added by ${quote.createdBy.name}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {quote.lines.length > 0 && (
                  <table className="mt-2 text-[13px] font-light">
                    <tbody>
                      {quote.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="text-ink-900 pr-3 align-top whitespace-nowrap">{line.quantity} ×</td>
                          <td className="text-ink-900 pr-4 align-top">
                            {line.description}
                            {line.unit && <span className="text-ink-500"> · {line.unit}</span>}
                          </td>
                          <td className="text-ink-500 pr-3 text-right align-top whitespace-nowrap">{formatMoney(line.unitPriceCents, quote.currency)}</td>
                          <td className="text-ink-900 text-right align-top whitespace-nowrap">{formatMoney(line.quantity * line.unitPriceCents, quote.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {quote.notes && <p className="text-ink-700 mt-1 line-clamp-2 text-[13px] font-light whitespace-pre-line">{quote.notes}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {quote.documentUrl && (
                    <a href={quote.documentUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                      📎 Open the quote ↗
                    </a>
                  )}
                  {quote.contract ? (
                    <Link href={contractHref(quote.contract.eventId, quote.contract.id)} className="text-brand-700 font-medium hover:underline">
                      Open its contract →
                    </Link>
                  ) : (
                    <>
                      <button type="button" onClick={() => setEditing(quote)} className="text-brand-700 hover:underline">
                        Edit
                      </button>
                      {quote.status !== "DECLINED" && (
                        <button
                          type="button"
                          disabled={accept.isPending}
                          onClick={() => window.confirm(`Accept "${quote.title}" and make it the contractor's contract${quote.totalCents != null ? `, worth ${formatMoney(quote.totalCents, quote.currency)}` : ""}?`) && accept.mutate({ id: quote.id })}
                          className="text-brand-700 font-medium hover:underline"
                        >
                          {accept.isPending && accept.variables?.id === quote.id ? "Making the contract…" : "Accept and make the contract"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setStatus.mutate({ id: quote.id, status: quote.status === "DECLINED" ? "RECEIVED" : "DECLINED" })}
                        className="text-ink-500 hover:underline"
                      >
                        {quote.status === "DECLINED" ? "Back to received" : "Decline"}
                      </button>
                      <button type="button" onClick={() => window.confirm(`Remove the quote "${quote.title}"?`) && remove.mutate({ id: quote.id })} className="text-[#c03654] hover:underline">
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
              {quote.totalCents != null && (
                <p className="text-ink-900 shrink-0 text-right text-[15px] font-semibold whitespace-nowrap">
                  {formatMoney(quote.totalCents, quote.currency)}
                  <InUsd cents={quote.totalCents} currency={quote.currency} />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError message={error ? friendlyError(error) : null} />
      <button type="button" onClick={() => setEditing("new")} className="text-brand-700 mt-2 text-[13px] font-medium hover:underline">
        + Add quote
      </button>
      {editing && <QuotePopup contractorId={contractorId} quote={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function QuotePopup({ contractorId, quote, onClose, onSaved }: { contractorId: string; quote: Quote | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(quote?.title ?? "");
  const [amount, setAmount] = useState(quote?.amountCents != null ? String(quote.amountCents / 100) : "");
  const [currency, setCurrency] = useState(quote?.currency ?? "USD");
  const [receivedOn, setReceivedOn] = useState(quote?.receivedOn ? dayKey(quote.receivedOn) : dayKey(new Date()));
  const [validUntil, setValidUntil] = useState(quote?.validUntil ? dayKey(quote.validUntil) : "");
  const [documentUrl, setDocumentUrl] = useState(quote?.documentUrl ?? "");
  const [notes, setNotes] = useState(quote?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    quote?.lines.map((line) => ({ description: line.description, quantity: String(line.quantity), unit: line.unit ?? "", price: String(line.unitPriceCents / 100) })) ?? [],
  );
  const readLines = lines.map((line) => ({ description: line.description.trim(), quantity: Number(line.quantity), unit: line.unit.trim(), unitPriceCents: parseMoney(line.price) }));
  const badLines = readLines.some((line) => !line.description || !Number.isInteger(line.quantity) || line.quantity < 1 || line.unitPriceCents === null || Number.isNaN(line.unitPriceCents));
  const linesTotal = badLines ? null : readLines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents!, 0);
  const setLine = (index: number, change: Partial<LineDraft>) => setLines(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));
  const done = () => {
    onSaved();
    onClose();
  };
  const add = api.contractor.addQuote.useMutation({ onSuccess: done });
  const update = api.contractor.updateQuote.useMutation({ onSuccess: done });
  const cents = parseMoney(amount);
  const badAmount = Number.isNaN(cents);
  const pending = add.isPending || update.isPending;
  const error = add.error ?? update.error;

  return (
    <Popup size="large" title={quote ? "Edit quote" : "New quote"} subtitle="What the contractor quoted, with its file. Accepted, it becomes their contract." onClose={onClose}>
      <form
        className="space-y-4 rounded-xl bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (badAmount || (lines.length > 0 && badLines)) return;
          const data = {
            title,
            amountCents: lines.length ? null : cents,
            currency,
            receivedOn: receivedOn || null,
            validUntil: validUntil || null,
            documentUrl,
            notes,
            lines: readLines.map((line) => ({ description: line.description, quantity: line.quantity, unit: line.unit || undefined, unitPriceCents: line.unitPriceCents! })),
          };
          if (quote) update.mutate({ id: quote.id, ...data });
          else add.mutate({ contractorId, ...data });
        }}
      >
        <Field label="What it is for">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Furniture for 40 apartments" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          {lines.length ? (
            <Field label="Total">
              <p className="text-ink-900 py-2 text-[14px] font-semibold">{linesTotal === null ? "—" : formatMoney(linesTotal, currency)}</p>
            </Field>
          ) : (
            <Field label="Amount — optional">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12500" inputMode="decimal" />
            </Field>
          )}
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencyOptions(currency).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          </Field>
        </div>
        {badAmount && !lines.length && <p className="-mt-2 text-xs text-[#c03654]">The amount should be a number, like 12500 or 12500.50.</p>}
        <div>
          <span className="text-ink-700 mb-1 block text-[13px] font-medium">Lines — optional</span>
          <p className="text-ink-500 mb-2 text-xs font-light">For a quote made of items — vehicles, services: each with how many, what one is, and its price. The total is their sum.</p>
          {lines.length > 0 && (
            <div className="mb-2 space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-[4rem_1fr_9rem_7rem_auto] items-center gap-2">
                  <Input value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} inputMode="numeric" aria-label="How many" placeholder="4" />
                  <Input value={line.description} onChange={(e) => setLine(index, { description: e.target.value })} aria-label="What it is" placeholder="Sprinter van, 16 seats" />
                  <Input value={line.unit} onChange={(e) => setLine(index, { unit: e.target.value })} aria-label="What one is" placeholder="per vehicle per day" />
                  <Input value={line.price} onChange={(e) => setLine(index, { price: e.target.value })} inputMode="decimal" aria-label="Price of one" placeholder="350" />
                  <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))} className="text-ink-400 text-lg leading-none hover:text-[#c03654]" aria-label="Remove the line">
                    ×
                  </button>
                </div>
              ))}
              {badLines && <p className="text-xs text-[#c03654]">Each line needs how many (a whole number), what it is, and a price.</p>}
            </div>
          )}
          <button type="button" onClick={() => setLines([...lines, { quantity: "1", description: "", unit: "", price: "" }])} className="text-brand-700 text-[13px] font-medium hover:underline">
            + Add a line
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received">
            <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </Field>
          <Field label="Valid until — optional">
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>
        <Field label="The quote — optional">
          <FileField value={documentUrl} onChange={setDocumentUrl} label="Quote" />
        </Field>
        <Field label="Notes — optional">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What it includes, delivery, payment terms…" />
        </Field>
        <FormError message={error ? friendlyError(error) : null} />
        <Button type="submit" disabled={!title.trim() || (lines.length ? badLines : badAmount) || pending}>
          {pending ? "Saving…" : quote ? "Save" : "Add quote"}
        </Button>
      </form>
    </Popup>
  );
}

/** Files and links on a contractor: upload one, or paste a Google Sheet, Doc or any link. */
export function ContractorFiles({ contractorId }: { contractorId: string }) {
  const utils = api.useUtils();
  const files = api.contractor.files.useQuery({ contractorId });
  const refresh = () => {
    void utils.contractor.files.invalidate({ contractorId });
    void utils.audit.invalidate();
  };
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const add = api.contractor.addFile.useMutation({
    onSuccess: () => {
      setUrl("");
      setName("");
      refresh();
    },
  });
  const remove = api.contractor.removeFile.useMutation({ onSuccess: refresh });
  const rows = files.data ?? [];
  const uploaded = isStoredLink(url);

  return (
    <div>
      {rows.length > 0 && (
        <ul className="divide-ink-200/60 mb-3 divide-y">
          {rows.map((file) => {
            const kind = isStoredLink(file.url) ? { icon: "📎", label: "File" } : linkKind(file.url);
            return (
              <li key={file.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="shrink-0" aria-hidden>
                  {kind.icon}
                </span>
                <a href={file.url} target="_blank" rel="noreferrer" className="text-ink-900 hover:text-brand-700 min-w-0 flex-1 truncate font-medium hover:underline">
                  {file.name}
                </a>
                <span className="text-ink-500 shrink-0 text-xs font-light">
                  {kind.label} · {file.addedBy?.name ?? "someone"} · {formatMomentInWords(file.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => window.confirm(`Take "${file.name}" off this contractor?`) && remove.mutate({ id: file.id })}
                  className="text-ink-400 shrink-0 text-lg leading-none hover:text-[#c03654]"
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length === 0 && !files.isLoading && <p className="text-ink-500 mb-3 text-[13px] font-light">No files yet.</p>}
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) add.mutate({ contractorId, url: url.trim(), name: name.trim() || (uploaded ? (storedName(url) ?? undefined) : undefined) });
        }}
      >
        <FileField value={url} onChange={setUrl} label="File" placeholder="…or paste a Google Sheet, Doc or any link" className="flex-[2]" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name — optional"
          aria-label="Name of the file"
          className="border-ink-200 focus:border-brand-400 min-w-40 flex-1 rounded-lg border bg-white px-3 py-2 text-[13px] outline-none"
        />
        <button type="submit" disabled={add.isPending || !url.trim()} className="bg-brand-400 hover:bg-brand-500 rounded-full px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">
          {add.isPending ? "Adding…" : "Add to files"}
        </button>
      </form>
      {add.error && <p className="mt-1 text-xs text-[#c03654]">{friendlyError(add.error)}</p>}
    </div>
  );
}

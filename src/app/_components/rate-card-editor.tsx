"use client";

import { useEffect, useState } from "react";

import { Button, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { RateCardView, type ClientRateCard } from "~/app/_components/rate-card-view";
import { Photo } from "~/app/_components/photo";
import { nightsBetween } from "~/lib/dates";
import { clientMedia } from "~/lib/media";
import { formatMoment, formatMoney, formatNights, formatRange } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

type Card = RouterOutputs["rateCard"]["byId"];
type Draft = {
  name: string;
  intro: string;
  markup: string;
  properties: { id: string; description: string; photoIds: string[]; lines: { id: string; selling: string; available: string; minNights: string }[] }[];
  removed: string[];
};

const toCents = (text: string) => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
};
const toText = (cents: number | null) => (cents === null ? "" : String(cents / 100));
const toCount = (text: string) => {
  const value = Number(text.trim());
  return text.trim() && Number.isInteger(value) && value > 0 ? value : null;
};
const draftOf = (card: Card): Draft => ({
  name: card.name,
  intro: card.intro ?? "",
  markup: card.markupBasisPoints === null ? "" : String(card.markupBasisPoints / 100),
  properties: card.properties.map((property) => ({
    id: property.id,
    description: property.description ?? "",
    photoIds: property.photoIds,
    lines: property.lines.map((line) => ({
      id: line.id,
      selling: toText(line.sellingCents),
      available: line.available === null ? "" : String(line.available),
      minNights: line.minNights === null ? "" : String(line.minNights),
    })),
  })),
  removed: [],
});
const distance = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/**
 * A rate card, made and changed in a popup (doc §4.11): each property's short
 * description — with a writing helper — and each room category's selling
 * rate beside our buying rate, a markup applied to all at once, a preview of
 * exactly what the client sees, and the client's link.
 */
export function RateCardEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const utils = api.useUtils();
  const card = api.rateCard.byId.useQuery({ id }, { refetchOnWindowFocus: false });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (card.data && !draft) {
      setDraft(draftOf(card.data));
      setSaved(JSON.stringify(draftOf(card.data)));
    }
  }, [card.data, draft]);

  // Opening the card is reading the client's answers: they stop counting as new (doc §4.11).
  const markSeen = api.rateCard.markSeen.useMutation({
    onSuccess: () => {
      void utils.rateCard.forRequest.invalidate();
      void utils.rateCard.newAnswers.invalidate();
      void utils.sales.list.invalidate();
    },
  });
  const hasNew = Boolean(card.data?.answers.some((answer) => answer.isNew));
  useEffect(() => {
    if (hasNew && markSeen.isIdle) markSeen.mutate({ id });
  }, [hasNew, id, markSeen]);

  const save = api.rateCard.save.useMutation({
    onSuccess: () => {
      setSaved(JSON.stringify(draft));
      void utils.rateCard.invalidate();
    },
  });
  const share = api.rateCard.share.useMutation({
    onSuccess: () => {
      void utils.rateCard.byId.invalidate({ id });
      void utils.sales.invalidate();
    },
  });
  const unshare = api.rateCard.unshare.useMutation({ onSuccess: () => void utils.rateCard.byId.invalidate({ id }) });
  const describe = api.rateCard.describe.useMutation();
  const remove = api.rateCard.remove.useMutation({
    onSuccess: () => {
      void utils.rateCard.invalidate();
      onClose();
    },
  });

  const c = card.data;
  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  /** Rooms offered without how many units or the shortest stay — not saved until given (doc §4.11). */
  const incomplete = draft
    ? draft.properties
        .filter((property) => !draft.removed.includes(property.id))
        .flatMap((property) => property.lines)
        .filter((line) => toCents(line.selling) !== null && (toCount(line.available) === null || toCount(line.minNights) === null)).length
    : 0;
  const close = () => {
    if (dirty && !window.confirm("Close without saving the rate card?")) return;
    onClose();
  };
  const link = c?.shareToken ? `${origin}/rate-card/${c.shareToken}` : null;

  const doSave = () => {
    if (!draft) return;
    save.mutate({
      id,
      name: draft.name,
      intro: draft.intro,
      markupBasisPoints: draft.markup.trim() ? Math.round(Number(draft.markup.replace(",", ".")) * 100) : null,
      properties: draft.properties.map((property) => ({
        id: property.id,
        description: property.description,
        photoIds: property.photoIds,
        lines: property.lines.map((line) => ({ id: line.id, sellingCents: toCents(line.selling), available: toCount(line.available), minNights: toCount(line.minNights) })),
      })),
      removedPropertyIds: draft.removed,
    });
  };

  const setProperty = (propertyId: string, change: (property: Draft["properties"][number]) => Draft["properties"][number]) =>
    setDraft((current) => (current ? { ...current, properties: current.properties.map((property) => (property.id === propertyId ? change(property) : property)) } : current));

  /** The markup, applied to every room with a buying rate. */
  const applyMarkup = () => {
    if (!draft || !c) return;
    const percent = Number(draft.markup.replace(",", "."));
    if (!Number.isFinite(percent)) return;
    setDraft({
      ...draft,
      properties: draft.properties.map((property) => {
        const source = c.properties.find((one) => one.id === property.id);
        return {
          ...property,
          lines: property.lines.map((line) => {
            const buying = source?.lines.find((one) => one.id === line.id)?.buyingCents ?? null;
            return buying === null ? line : { ...line, selling: String(Math.round(buying * (1 + percent / 100)) / 100) };
          }),
        };
      }),
    });
  };

  // What the client will see, from the draft as it stands.
  const clientCard: ClientRateCard | null =
    c && draft
      ? {
          name: draft.name,
          currency: c.currency,
          intro: draft.intro.trim() || null,
          clientName: c.clientName,
          event: c.event,
          asked: c.asked,
          properties: draft.properties
            .filter((property) => !draft.removed.includes(property.id))
            .map((property) => {
              const source = c.properties.find((one) => one.id === property.id)!;
              return {
                id: property.id,
                name: source.name,
                type: source.type,
                stars: source.stars,
                where: source.where,
                nearest: source.nearest,
                description: property.description.trim() || null,
                ...clientMedia({ ...source, photoIds: property.photoIds }),
                lines: property.lines
                  .map((line) => ({ line, source: source.lines.find((one) => one.id === line.id)! }))
                  .filter(({ line }) => toCents(line.selling) !== null)
                  .map(({ line, source: lineSource }) => ({
                    id: line.id,
                    categoryId: lineSource.categoryId,
                    name: lineSource.name,
                    sleeps: lineSource.sleeps,
                    sellingCents: toCents(line.selling)!,
                    available: toCount(line.available),
                    minNights: toCount(line.minNights),
                  })),
              };
            })
            .filter((property) => property.lines.length > 0),
        }
      : null;

  return (
    <Popup
      title={draft?.name ?? "Rate card"}
      subtitle={c ? `For ${c.clientName}${c.event ? ` · ${c.event.name}` : ""} — buying rates are for us only; the client never sees them.` : undefined}
      onClose={close}
      aside={
        c && (
          <span className="flex items-center gap-4 text-[13px] font-light">
            <button type="button" onClick={() => setPreview(!preview)} className="text-brand-700 hover:underline">
              {preview ? "Back to editing" : "Preview what the client sees"}
            </button>
            <a href={`/rate-cards/${id}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline" title="Save first — the printout shows what is saved">
              Print or save as PDF ↗
            </a>
          </span>
        )
      }
    >
      {!c || !draft ? (
        <p className="text-ink-500 text-sm font-light">{card.error ? friendlyError(card.error) : "Loading…"}</p>
      ) : preview && clientCard ? (
        <div className="pb-4">
          <RateCardView card={clientCard} />
        </div>
      ) : (
        <div className="space-y-4 pb-20">
          <div className="border-ink-200/60 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="text-ink-700 mb-1 block text-[13px] font-medium">Name — for us</span>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <div>
              <span className="text-ink-700 mb-1 block text-[13px] font-medium">Markup on our buying rate</span>
              <span className="flex items-center gap-2">
                <span className="w-24">
                  <Input inputMode="decimal" value={draft.markup} onChange={(e) => setDraft({ ...draft, markup: e.target.value })} aria-label="Markup %" />
                </span>
                <span className="text-ink-500 text-sm">%</span>
                <Button type="button" variant="secondary" onClick={applyMarkup} disabled={!draft.markup.trim()}>
                  Apply to all
                </Button>
              </span>
            </div>
            <label className="block sm:col-span-2">
              <span className="text-ink-700 mb-1 block text-[13px] font-medium">A word to the client — optional, at the top of the card</span>
              <Textarea rows={2} value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} placeholder="Thank you for your request. Here are the properties we can offer for your stay." />
            </label>
          </div>

          {draft.properties
            .filter((property) => !draft.removed.includes(property.id))
            .map((property) => {
              const source = c.properties.find((one) => one.id === property.id)!;
              const writing = describe.isPending && describe.variables?.rateCardPropertyId === property.id;
              return (
                <section key={property.id} className="border-ink-200/60 rounded-xl border bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-ink-900 text-[15px] font-semibold">
                      {source.name}
                      {source.stars ? <span className="text-brand-700 ml-1.5 text-xs">{"★".repeat(source.stars)}</span> : null}
                      <span className="text-ink-500 ml-2 text-xs font-light">
                        {source.nearest ? `${distance(source.nearest.km)} from ${source.nearest.name}` : "No distance — no coordinates or venue"}
                      </span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, removed: [...draft.removed, property.id] })}
                      className="text-xs font-light text-[#c03654] hover:underline"
                    >
                      Take off the card
                    </button>
                  </div>
                  <div className="mt-2">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-ink-700 text-[13px] font-medium">Short description</span>
                      <button
                        type="button"
                        disabled={writing}
                        onClick={() =>
                          describe.mutate(
                            { rateCardPropertyId: property.id, draft: property.description },
                            { onSuccess: (result) => setProperty(property.id, (one) => ({ ...one, description: result.description })) },
                          )
                        }
                        className="text-brand-700 text-xs font-medium hover:underline disabled:opacity-60"
                      >
                        {writing ? "Writing…" : property.description.trim() ? "✨ Polish it" : "✨ Write it for me"}
                      </button>
                    </div>
                    <Textarea
                      rows={2}
                      value={property.description}
                      onChange={(e) => setProperty(property.id, (one) => ({ ...one, description: e.target.value }))}
                      placeholder="Two or three sentences for the client — the area, the style, what makes it suit them."
                    />
                    {describe.error && describe.variables?.rateCardPropertyId === property.id && (
                      <p className="mt-1 text-xs text-[#c03654]">{friendlyError(describe.error)}</p>
                    )}
                  </div>
                  <CardPhotos
                    propertyId={source.propertyId}
                    photos={source.allPhotos}
                    chosen={property.photoIds}
                    hasVideo={Boolean(source.videoUrl)}
                    onChange={(photoIds) => setProperty(property.id, (one) => ({ ...one, photoIds }))}
                  />
                  <table className="mt-3 w-full text-left text-[13px]">
                    <thead>
                      <tr className="text-ink-500 border-ink-200/60 border-b text-[10px] tracking-wider uppercase">
                        <th className="pb-1.5 font-medium">Room type</th>
                        <th className="pb-1.5 font-medium">Sleeps</th>
                        <th className="pb-1.5 font-medium">Our cost / night</th>
                        <th className="pb-1.5 font-medium">Client pays / night ({c.currency})</th>
                        <th className="pb-1.5 font-medium">Units available</th>
                        <th className="pb-1.5 font-medium">Min. stay (nights)</th>
                        <th className="pb-1.5 text-right font-medium">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {property.lines.map((line) => {
                        const lineSource = source.lines.find((one) => one.id === line.id)!;
                        const selling = toCents(line.selling);
                        const margin = selling !== null && lineSource.buyingCents ? selling - lineSource.buyingCents : null;
                        return (
                          <tr key={line.id} className="border-ink-200/40 border-b last:border-0">
                            <td className="text-ink-900 py-1.5">{lineSource.name}</td>
                            <td className="text-ink-500 py-1.5 font-light">{lineSource.sleeps ?? "—"}</td>
                            <td className="text-ink-500 py-1.5 font-light">
                              {lineSource.buyingCents !== null ? formatMoney(lineSource.buyingCents, c.currency) : <span className="text-ink-500/60">No rate yet</span>}
                            </td>
                            <td className="py-1.5">
                              <span className="block w-32">
                                <Input
                                  inputMode="decimal"
                                  value={line.selling}
                                  placeholder="Not offered"
                                  aria-label={`Selling rate for ${lineSource.name}`}
                                  onChange={(e) =>
                                    setProperty(property.id, (one) => ({
                                      ...one,
                                      lines: one.lines.map((other) => (other.id === line.id ? { ...other, selling: e.target.value } : other)),
                                    }))
                                  }
                                />
                              </span>
                            </td>
                            {(["available", "minNights"] as const).map((field) => {
                              const missing = selling !== null && toCount(line[field]) === null;
                              return (
                                <td key={field} className="py-1.5 pr-2">
                                  <span className={`block w-20 rounded-lg ${missing ? "ring-2 ring-[#c03654]/50" : ""}`}>
                                    <Input
                                      inputMode="numeric"
                                      value={line[field]}
                                      placeholder={selling !== null ? "Needed" : ""}
                                      aria-label={`${field === "available" ? "Units available" : "Minimum stay"} for ${lineSource.name}`}
                                      onChange={(e) =>
                                        setProperty(property.id, (one) => ({
                                          ...one,
                                          lines: one.lines.map((other) => (other.id === line.id ? { ...other, [field]: e.target.value } : other)),
                                        }))
                                      }
                                    />
                                  </span>
                                </td>
                              );
                            })}
                            <td className={`py-1.5 text-right whitespace-nowrap ${margin !== null && margin < 0 ? "text-[#c03654]" : "text-ink-500"}`}>
                              {margin !== null && lineSource.buyingCents
                                ? `${formatMoney(margin, c.currency)} · ${Math.round((margin / lineSource.buyingCents) * 100)}%`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {property.lines.length === 0 && <p className="text-ink-500 mt-2 text-xs font-light">No room categories recorded for this property yet.</p>}
                </section>
              );
            })}

          {c.answers.length > 0 && <ClientAnswers answers={c.answers} currency={c.currency} />}

          <div className="border-ink-200/60 rounded-xl border bg-white p-4 text-[13px]">
            <p className="text-ink-900 font-medium">The client&apos;s link</p>
            <p className="text-ink-500 mb-2 text-xs font-light">A page with this rate card for the client — no account needed, never our buying rates. Save first: the link shows what is saved.</p>
            {link ? (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                  }
                  className="text-brand-700 font-medium hover:underline"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a href={link} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                  Open ↗
                </a>
                <button type="button" onClick={() => window.confirm("Switch the link off? It will show nothing any more.") && unshare.mutate({ id })} className="text-[#c03654] hover:underline">
                  Switch off
                </button>
              </span>
            ) : (
              <Button type="button" variant="secondary" disabled={share.isPending} onClick={() => share.mutate({ id })}>
                {share.isPending ? "Making the link…" : "Make a link for the client"}
              </Button>
            )}
            {share.error && <p className="mt-2 text-xs text-[#c03654]">{friendlyError(share.error)}</p>}
          </div>
        </div>
      )}

      {c && draft && !preview && (
        <div className="sticky -bottom-6 -mx-6 -mb-6 flex items-center gap-2 border-t border-ink-200/60 px-6 py-3" style={{ backgroundColor: "#f3f3f3" }}>
          <FormError message={save.error ? friendlyError(save.error) : null} />
          <button
            type="button"
            onClick={() => window.confirm("Delete this rate card? Its link stops working.") && remove.mutate({ id })}
            className="text-xs font-light text-[#c03654] hover:underline"
          >
            Delete rate card
          </button>
          {incomplete > 0 ? (
            <span className="ml-auto text-xs text-[#c03654]">
              Units available and minimum stay needed for {incomplete} {incomplete === 1 ? "room" : "rooms"}
            </span>
          ) : (
            <span className="text-ink-500 ml-auto text-xs font-light">{dirty ? "Not saved yet" : "Saved"}</span>
          )}
          <Button type="button" disabled={save.isPending || !dirty || incomplete > 0} onClick={doSave}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </Popup>
  );
}

/**
 * What the client sent back from the link (doc §4.11), newest first: the
 * rooms they are interested in, for which nights, their notes and any change
 * of dates. Each answer stands as sent — a later one does not rewrite it.
 */
function ClientAnswers({ answers, currency }: { answers: RouterOutputs["rateCard"]["byId"]["answers"]; currency: string }) {
  return (
    <div className="border-brand-200 bg-brand-50/50 rounded-xl border p-4 text-[13px]">
      <p className="text-ink-900 font-medium">The client&apos;s answers</p>
      <ul className="mt-2 space-y-3">
        {answers.map((answer) => (
          <li key={answer.id} className="rounded-lg bg-white px-3 py-2.5">
            <p className="text-ink-500 text-xs font-light">
              {answer.isNew && <span className="mr-1.5 rounded-full bg-[#e0234e] px-1.5 py-px text-[10px] font-medium text-white">New</span>}
              {formatMoment(answer.at)}
              {answer.name || answer.email ? ` · ${[answer.name, answer.email].filter(Boolean).join(" · ")}` : ""}
            </p>
            {answer.items.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {answer.items.map((item, index) => (
                  <li key={index} className="text-ink-700 font-light">
                    <span className="text-ink-900 font-medium">
                      {item.rooms} × {item.roomName}
                    </span>{" "}
                    at {item.propertyName}
                    {item.checkIn && item.checkOut ? ` · ${formatRange(item.checkIn, item.checkOut)} (${formatNights(nightsBetween(item.checkIn, item.checkOut))})` : ""}
                    {item.sellingCents !== null ? ` · ${formatMoney(item.sellingCents, currency)} a night` : ""}
                    {item.note && <span className="text-ink-500 block pl-3 italic">“{item.note}”</span>}
                  </li>
                ))}
              </ul>
            )}
            {answer.datesChanged && (
              <p className="mt-1 text-[#a35a00]">
                Dates have changed
                {answer.newCheckIn && answer.newCheckOut ? `: now ${formatRange(answer.newCheckIn, answer.newCheckOut)}` : ""}
                {answer.datesNote ? ` — ${answer.datesNote}` : ""}
              </p>
            )}
            {answer.note && <p className="text-ink-700 mt-1 font-light whitespace-pre-line">{answer.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Which of the property's photos this card shows (doc §4.11): every photo
 * picked for clients on its Media tab, those on the card numbered in the
 * order the client sees them — click to put one on or take it off.
 */
function CardPhotos({
  propertyId,
  photos,
  chosen,
  hasVideo,
  onChange,
}: {
  propertyId: string;
  photos: { id: string; src: string; caption: string | null; categoryName: string | null }[];
  chosen: string[];
  hasVideo: boolean;
  onChange: (photoIds: string[]) => void;
}) {
  const mediaHref = `/properties/${propertyId}#media`;
  if (photos.length === 0) {
    return (
      <p className="mt-3 rounded-lg bg-[#fff4e0] px-3 py-2 text-xs text-[#8a5a00]">
        {hasVideo ? "No photos for this property yet — the client sees the video only." : "No photos or video for this property yet."}{" "}
        <a href={mediaHref} target="_blank" rel="noreferrer" className="font-medium underline">
          Add them on its Media tab ↗
        </a>
      </p>
    );
  }
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-ink-700 text-[13px] font-medium">
          Photos on this card <span className="text-ink-500 font-light">— {chosen.length} of {photos.length}; the first is the cover</span>
        </span>
        <a href={mediaHref} target="_blank" rel="noreferrer" className="text-brand-700 text-xs hover:underline">
          Media tab ↗
        </a>
      </div>
      <ul className="flex flex-wrap gap-2">
        {photos.map((photo) => {
          const at = chosen.indexOf(photo.id);
          const on = at >= 0;
          return (
            <li key={photo.id}>
              <button
                type="button"
                aria-pressed={on}
                title={[photo.categoryName, photo.caption].filter(Boolean).join(" — ") || undefined}
                onClick={() => onChange(on ? chosen.filter((id) => id !== photo.id) : [...chosen, photo.id])}
                className={`relative block h-16 w-20 overflow-hidden rounded-lg border-2 transition ${on ? "border-brand-500" : "border-transparent opacity-45 hover:opacity-80"}`}
              >
                <Photo src={photo.src} alt={photo.caption ?? "Photo"} sizes="80px" />
                {on && <span className="bg-brand-500 absolute top-1 left-1 rounded-full px-1.5 text-[10px] font-medium text-white">{at + 1}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

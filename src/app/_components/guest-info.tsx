"use client";

import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { StayPropertySection } from "~/app/_components/stay-page";
import { Card } from "~/app/_components/ui";
import { parseDay } from "~/lib/dates";
import { formatDate, formatRange } from "~/lib/format";
import { guestFields, missingGuestInfo, type GuestKey } from "~/lib/guest-info";
import { api } from "~/trpc/react";

/**
 * A property's Guest information tab (doc §6.8): what guests need to know,
 * shown exactly as the client's page shows it, with Edit in a popup.
 */
export function PropertyGuestInfo({ propertyId }: { propertyId: string }) {
  const info = api.guestInfo.property.useQuery({ propertyId });
  const [editing, setEditing] = useState(false);
  if (!info.data) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  const missing = missingGuestInfo(info.data);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-ink-500 max-w-xl text-[13px] font-light">
          What guests need to know about this property. Clients see it on their property information page — the link is made on their sales
          request, under <em>Guest information</em> — exactly as below, with their own rooms.
        </p>
        <Button type="button" variant="secondary" onClick={() => setEditing(true)} aria-label="Edit guest information">
          Edit
        </Button>
      </div>
      {missing.length > 0 && (
        <p className="rounded-lg bg-[#fff4e0] px-3 py-2 text-[13px] font-light text-[#8a5a00]">
          Still to fill in: {missing.join(", ")}.
        </p>
      )}
      <StayPropertySection property={info.data} />
      {editing && <GuestInfoEditor info={info.data} onClose={() => setEditing(false)} />}
    </div>
  );
}

function GuestInfoEditor({ info, onClose }: { info: Record<GuestKey, string | null> & { id: string; name: string }; onClose: () => void }) {
  const utils = api.useUtils();
  const [values, setValues] = useState(() => Object.fromEntries(guestFields.map((field) => [field.key, info[field.key] ?? ""])) as Record<GuestKey, string>);
  const save = api.guestInfo.saveProperty.useMutation({
    onSuccess: () => {
      void utils.guestInfo.invalidate();
      void utils.audit.invalidate();
      onClose();
    },
  });
  return (
    <Popup title="Guest information" subtitle={info.name} size="medium" onClose={onClose}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ propertyId: info.id, ...values });
        }}
      >
        {guestFields.map((field) => (
          <Field key={field.key} label={field.label} className={"short" in field ? "" : "sm:col-span-2"}>
            {"short" in field ? (
              <Input value={values[field.key]} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} placeholder={field.placeholder} />
            ) : (
              <Textarea rows={2} value={values[field.key]} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} placeholder={field.placeholder} />
            )}
          </Field>
        ))}
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {save.error && <FormError message={friendlyError(save.error)} />}
        </div>
      </form>
    </Popup>
  );
}

/**
 * On a sales request (doc §6.8): the client's property information page —
 * which properties it covers, what is still missing on each, We Lodge's
 * contact for guests at the event, and the link to send.
 */
export function RequestGuestInfo({ salesRequestId }: { salesRequestId: string }) {
  const utils = api.useUtils();
  const data = api.guestInfo.forRequest.useQuery({ salesRequestId });
  const refresh = () => (void utils.guestInfo.forRequest.invalidate({ salesRequestId }), void utils.audit.invalidate());
  const make = api.guestInfo.makeLink.useMutation({ onSuccess: refresh });
  const off = api.guestInfo.switchOffLink.useMutation({ onSuccess: refresh });
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  if (!data.data) return <Card><p className="text-ink-500 text-sm font-light">Loading…</p></Card>;
  const { token, madeAt, event, properties } = data.data;
  const url = token ? `${origin}/stay/${token}` : null;
  const error = make.error ?? off.error;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <h3 className="text-ink-900 text-[15px] font-medium">Property information for the client</h3>
        <p className="text-ink-500 mt-1 text-[13px] font-light">
          One web page with everything guests need to know about each property the client has bought rooms in — check-in, what to bring, city tax,
          parking and the rest. Send the link once: it always shows the latest, and the client can save it as a PDF.
        </p>

        {!event ? (
          <p className="text-ink-500 mt-4 text-[13px] font-light">Choose the event under Details first.</p>
        ) : properties.length === 0 ? (
          <p className="text-ink-500 mt-4 text-[13px] font-light">No rooms sold to the client at {event.name} yet — the page lists the properties once they are.</p>
        ) : (
          <ul className="divide-ink-100 mt-4 divide-y">
            {properties.map((property) => (
              <li key={property.id} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a href={`/properties/${property.id}#guest`} className="text-ink-900 text-[13px] font-medium hover:underline">
                    {property.name}
                  </a>
                  {property.missing.length ? (
                    <a href={`/properties/${property.id}#guest`} className="text-xs font-light text-[#8a5a00] hover:underline">
                      Missing: {property.missing.join(", ")} →
                    </a>
                  ) : (
                    <span className="text-xs font-light text-[#0a7a47]">✓ Ready</span>
                  )}
                </div>
                <p className="text-ink-500 text-xs font-light">
                  {property.rooms.map((run) => `${run.rooms} × ${run.category}, ${formatRange(parseDay(run.checkIn), parseDay(run.checkOut))}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="border-ink-200/60 mt-4 border-t pt-4">
          <p className="text-ink-900 text-[13px] font-medium">Link for the client</p>
          {url ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="bg-ink-50 text-ink-700 max-w-full truncate rounded px-2 py-1 text-xs">{url}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))}
                className="text-brand-700 text-xs font-medium hover:underline"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <a href={url} target="_blank" rel="noreferrer" className="text-brand-700 text-xs font-light hover:underline">
                Open ↗
              </a>
              <button type="button" disabled={off.isPending} onClick={() => off.mutate({ salesRequestId })} className="text-xs font-light text-[#c03654] hover:underline">
                Switch off
              </button>
            </div>
          ) : (
            <div className="mt-1">
              <p className="text-ink-500 text-xs font-light">No sign-in; anyone with the link can open it, so send it only to the client. It never shows prices or our notes.</p>
              <button type="button" disabled={make.isPending} onClick={() => make.mutate({ salesRequestId })} className="text-brand-700 mt-2 text-[13px] font-medium hover:underline">
                {make.isPending ? "Making the link…" : madeAt ? "Make a new link" : "Make a link"}
              </button>
            </div>
          )}
          {madeAt && url && <p className="text-ink-500 mt-1 text-xs font-light">Made {formatDate(madeAt)}.</p>}
          {error && <FormError message={friendlyError(error)} />}
        </div>
      </Card>

      {event && <EventContact event={event} onSaved={refresh} />}
    </div>
  );
}

/** We Lodge's contact for guests at the event — the same on every client's page for it. */
function EventContact({ event, onSaved }: { event: { id: string; name: string; guestContact: string | null }; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(event.guestContact ?? "");
  const save = api.guestInfo.setEventContact.useMutation({ onSuccess: () => (onSaved(), setEditing(false)) });
  return (
    <Card>
      <h3 className="text-ink-900 text-[15px] font-medium">Our contact for guests</h3>
      <p className="text-ink-500 mt-1 text-xs font-light">At the top of every client&rsquo;s page for {event.name}.</p>
      {editing ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ eventId: event.id, guestContact: value });
          }}
        >
          <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={"Alex Lingois, on the ground in LA\n+1 213 555 0199 · ops@welodge.net"} />
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {save.error && <FormError message={friendlyError(save.error)} />}
        </form>
      ) : (
        <>
          <p className={`mt-3 text-[13px] font-light whitespace-pre-line ${event.guestContact ? "text-ink-900" : "text-[#8a5a00]"}`}>
            {event.guestContact ?? "Not given yet — guests will not see who to call."}
          </p>
          <button type="button" onClick={() => (setValue(event.guestContact ?? ""), setEditing(true))} className="text-brand-700 mt-2 text-[13px] font-medium hover:underline">
            {event.guestContact ? "Change" : "Add"}
          </button>
        </>
      )}
    </Card>
  );
}

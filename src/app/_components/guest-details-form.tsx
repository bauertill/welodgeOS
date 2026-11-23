"use client";

import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { formatMomentInWords } from "~/lib/format";
import { guestFields, type GuestKey } from "~/lib/guest-info";
import { api } from "~/trpc/react";

/**
 * The property's own form for its guest information (doc §6.8), from its
 * private link: what we already have, filled in to check, correct and
 * complete — the standard fields and any the team added — then sent.
 */
export function GuestDetailsForm({ token }: { token: string }) {
  const form = api.guestInfo.propertyForm.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const [values, setValues] = useState<Record<GuestKey, string> | null>(null);
  const [custom, setCustom] = useState<{ id: string; label: string; value: string }[]>([]);
  const [sent, setSent] = useState(false);
  const submit = api.guestInfo.submitPropertyForm.useMutation({
    onSuccess: () => {
      setSent(true);
      window.scrollTo({ top: 0 });
    },
  });

  useEffect(() => {
    if (!form.data || values) return;
    setValues(Object.fromEntries(guestFields.map((field) => [field.key, form.data.values[field.key] ?? ""])) as Record<GuestKey, string>);
    setCustom(form.data.custom);
  }, [form.data, values]);

  if (form.error) {
    return (
      <Card className="text-center">
        <h1 className="text-ink-900 text-lg font-medium">This link is not in use any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for a new one.</p>
      </Card>
    );
  }
  if (!form.data || !values) return <p className="text-ink-500 text-center text-sm font-light">Loading…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-ink-900 text-2xl font-medium">{form.data.name}</h1>
        <p className="text-ink-500 mt-1 text-[14px] font-light">
          What our guests need to know about your property. We have filled in what we already know — please check it, correct anything that is not
          right, and complete the rest. We share it with our guests before they arrive.
        </p>
        {form.data.submittedAt && !sent && <p className="text-ink-500 mt-2 text-xs font-light">Last sent {formatMomentInWords(form.data.submittedAt)}. You can send it again with any changes.</p>}
      </div>

      {sent && (
        <div className="rounded-xl border border-[#0a7a47]/20 bg-[#e8f6ee] px-4 py-3 text-[14px] text-[#0a5c36]">
          Thank you — we have it. You can come back to this link to change anything.
        </div>
      )}

      <Card>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate({ token, ...values, custom: custom.map(({ id, value }) => ({ id, value })) });
          }}
        >
          {/* The team's own fields before "Anything else", as the guests' page shows them. */}
          {[...guestFields.filter((field) => field.key !== "guestOther"), "custom" as const, ...guestFields.filter((field) => field.key === "guestOther")].map((field) =>
            field === "custom" ? (
              custom.map((extra) => (
                <Field key={extra.id} label={extra.label} className="sm:col-span-2">
                  <Textarea rows={2} value={extra.value} onChange={(e) => setCustom(custom.map((other) => (other.id === extra.id ? { ...other, value: e.target.value } : other)))} />
                </Field>
              ))
            ) : (
            <Field key={field.key} label={field.label} className={"short" in field ? "" : "sm:col-span-2"}>
              {"short" in field ? (
                <Input value={values[field.key]} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} placeholder={field.placeholder} />
              ) : (
                <Textarea rows={2} value={values[field.key]} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })} placeholder={field.placeholder} />
              )}
            </Field>
            ),
          )}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? "Sending…" : "Send to We Lodge"}
            </Button>
            {submit.error && <FormError message={friendlyError(submit.error)} />}
          </div>
        </form>
      </Card>
    </div>
  );
}

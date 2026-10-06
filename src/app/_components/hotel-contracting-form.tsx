"use client";

import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { contractingFields } from "~/lib/contracting";
import { formatMomentInWords } from "~/lib/format";
import { api } from "~/trpc/react";

type Key = (typeof contractingFields)[number]["key"];
type Values = Record<Key, string>;

const groups: { title: string; hint?: string; fields: { key: Key; placeholder?: string; wide?: boolean }[] }[] = [
  {
    title: "Company details",
    fields: [
      { key: "tradeName", placeholder: "The company's registered name", wide: true },
      { key: "vatNumber" },
      { key: "registrationNumber" },
    ],
  },
  { title: "Bank details", hint: "Where we pay the hotel.", fields: [{ key: "iban", wide: true }, { key: "bic" }] },
  {
    title: "Who signs",
    fields: [
      { key: "signatoryName" },
      { key: "signatoryTitle", placeholder: "General Manager" },
      { key: "contractEmail", placeholder: "contracts@hotel.com", wide: true },
    ],
  },
];
const labels = Object.fromEntries(contractingFields.map((field) => [field.key, field.label])) as Record<Key, string>;

/**
 * The page a hotel opens from its private link (doc §3.9): the legal entity a
 * contract is signed with — company, bank and signatory — sent straight to the
 * property. Nothing else of ours is on it.
 */
export function HotelContractingForm({ token }: { token: string }) {
  const form = api.property.contractingForm.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const [values, setValues] = useState<Values | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (form.data && !values) setValues(form.data.values);
  }, [form.data, values]);

  const submit = api.property.submitContracting.useMutation({
    onSuccess: () => {
      setSent(true);
      window.scrollTo({ top: 0 });
    },
  });

  if (form.isLoading) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  if (form.error || !form.data) {
    return (
      <Card>
        <h1 className="text-ink-900 text-lg font-medium">This link is not in use any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for a new one.</p>
      </Card>
    );
  }
  if (!values) return null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({ token, values });
      }}
    >
      <div>
        <h1 className="text-ink-900 text-2xl font-semibold">Contracting details</h1>
        <p className="text-ink-500 mt-1 text-sm font-light">
          For {form.data.propertyName}. We need these to draw up our agreement with you. They come straight to your contact at We Lodge.
        </p>
      </div>

      {sent && (
        <p className="rounded-lg bg-[#e3f8ee] px-4 py-3 text-sm text-[#0a7a47]">
          Thank you — your details have been sent to We Lodge. You can still correct them here and send again.
        </p>
      )}
      {!sent && form.data.submittedAt && (
        <p className="bg-brand-50 text-brand-800 rounded-lg px-4 py-3 text-sm font-light">
          You sent these {formatMomentInWords(form.data.submittedAt)}. Change anything that is wrong and send again.
        </p>
      )}

      {groups.map((group) => (
        <Card key={group.title}>
          <h2 className="text-ink-900 text-[15px] font-medium">{group.title}</h2>
          {group.hint && <p className="text-ink-500 text-xs font-light">{group.hint}</p>}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {group.fields.map((field) => (
              <Field key={field.key} label={labels[field.key]} className={field.wide ? "sm:col-span-2" : ""}>
                <Input
                  type={field.key === "contractEmail" ? "email" : "text"}
                  value={values[field.key]}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                />
              </Field>
            ))}
          </div>
        </Card>
      ))}

      <div className="space-y-2">
        <FormError message={submit.error ? friendlyError(submit.error) : null} />
        <Button type="submit" disabled={submit.isPending || !values.tradeName.trim()}>
          {submit.isPending ? "Sending…" : form.data.submittedAt || sent ? "Send again" : "Send to We Lodge"}
        </Button>
      </div>
    </form>
  );
}

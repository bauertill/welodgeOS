"use client";

import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { formatMomentInWords } from "~/lib/format";
import {
  joinContractContacts,
  splitContractContacts,
  type ClientContractingKey,
  type ContractContact,
} from "~/lib/sales";
import { api } from "~/trpc/react";

type Values = Record<Exclude<ClientContractingKey, "contractContacts">, string>;

const companyFields: { key: keyof Values; label: string; placeholder?: string; long?: boolean; wide?: boolean }[] = [
  { key: "tradeName", label: "Trade name", placeholder: "Your company's registered name", wide: true },
  { key: "companyAddress", label: "Company address", placeholder: "Street, postcode, city, country", long: true },
  { key: "vatNumber", label: "VAT number" },
  { key: "registrationNumber", label: "Registration number" },
];

const signatoryFields: { key: keyof Values; label: string; placeholder?: string }[] = [
  { key: "signatory1Name", label: "Name of signatory" },
  { key: "signatory1Designation", label: "Designation of signatory", placeholder: "Secretary General" },
  { key: "signatory2Name", label: "Name of a second signatory, if needed" },
  { key: "signatory2Designation", label: "Designation of the second signatory" },
];

const emptyPerson: ContractContact = { name: "", jobTitle: "", email: "" };

/**
 * The page a client opens from their private link (doc §4.11): their company
 * details and who signs, sent straight to the request. Nothing else about the
 * request is on it.
 */
export function ContractingForm({ token }: { token: string }) {
  const form = api.sales.contractingForm.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const [values, setValues] = useState<Values | null>(null);
  const [people, setPeople] = useState<ContractContact[]>([emptyPerson]);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!form.data || values) return;
    const { contractContacts, ...rest } = form.data.values;
    setValues(rest);
    const known = splitContractContacts(contractContacts);
    setPeople(known.length ? known : [emptyPerson]);
  }, [form.data, values]);

  const submit = api.sales.submitContracting.useMutation({
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
        <p className="text-ink-500 mt-2 text-sm font-light">
          Please ask your contact at We Lodge for a new one.
        </p>
      </Card>
    );
  }
  if (!values) return null;

  const set = (key: keyof Values) => (value: string) => setValues({ ...values, [key]: value });
  const setPerson = (index: number, key: keyof ContractContact, value: string) =>
    setPeople(people.map((person, i) => (i === index ? { ...person, [key]: value } : person)));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({ token, values: { ...values, contractContacts: joinContractContacts(people) } });
      }}
    >
      <div>
        <h1 className="text-ink-900 text-2xl font-semibold">Contracting details</h1>
        <p className="text-ink-500 mt-1 text-sm font-light">
          For {form.data.clientName}
          {form.data.eventName ? ` · ${form.data.eventName}` : ""}. We need these to draw up your agreement. They
          come straight to your contact at We Lodge.
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

      <Card>
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Company details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {companyFields.map((field) => (
            <Field key={field.key} label={field.label} className={field.long || field.wide ? "sm:col-span-2" : ""}>
              {field.long ? (
                <Textarea rows={2} value={values[field.key]} onChange={(e) => set(field.key)(e.target.value)} placeholder={field.placeholder} />
              ) : (
                <Input value={values[field.key]} onChange={(e) => set(field.key)(e.target.value)} placeholder={field.placeholder} />
              )}
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Who signs</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {signatoryFields.map((field) => (
            <Field key={field.key} label={field.label}>
              <Input value={values[field.key]} onChange={(e) => set(field.key)(e.target.value)} placeholder={field.placeholder} />
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-ink-900 mb-1 text-[15px] font-medium">Contact persons</h2>
        <p className="text-ink-500 mb-3 text-xs font-light">Who we should deal with about the agreement.</p>
        <div className="space-y-4">
          {people.map((person, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <Field label="Name">
                <Input value={person.name} onChange={(e) => setPerson(index, "name", e.target.value)} />
              </Field>
              <Field label="Job title">
                <Input value={person.jobTitle} onChange={(e) => setPerson(index, "jobTitle", e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" value={person.email} onChange={(e) => setPerson(index, "email", e.target.value)} />
              </Field>
              {people.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setPeople(people.filter((_, i) => i !== index))}
                  className="text-ink-500 pb-2.5 text-xs font-light hover:text-[#c03654]"
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPeople([...people, emptyPerson])}
          className="text-brand-700 mt-3 text-[13px] font-light hover:underline"
        >
          + Add another person
        </button>
      </Card>

      <div className="space-y-2">
        <FormError message={submit.error ? friendlyError(submit.error) : null} />
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? "Sending…" : "Send to We Lodge"}
        </Button>
      </div>
    </form>
  );
}

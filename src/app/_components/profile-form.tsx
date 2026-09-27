"use client";

import type { PhoneKind } from "generated/prisma";
import { useEffect, useState } from "react";

import {
  Button,
  Field,
  Fieldset,
  FormError,
  friendlyError,
  Input,
  Select,
} from "~/app/_components/form";
import { phoneKindLabels, phoneKinds } from "~/lib/team";
import { api } from "~/trpc/react";

type Phone = { key: number; number: string; kind: PhoneKind };

let nextKey = 0;

/** Completing one's own profile (doc §2.7). */
export function ProfileForm() {
  const utils = api.useUtils();
  const me = api.user.me.useQuery();
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phones, setPhones] = useState<Phone[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.name ?? "");
    setJobTitle(me.data.jobTitle ?? "");
    setPhones(me.data.phones.map((phone) => ({ ...phone, key: nextKey++ })));
  }, [me.data]);

  const save = api.user.updateProfile.useMutation({
    onSuccess: () => {
      setSaved(true);
      void utils.user.invalidate();
    },
  });

  const change = (key: number, patch: Partial<Phone>) => {
    setSaved(false);
    setPhones((list) => list.map((phone) => (phone.key === key ? { ...phone, ...patch } : phone)));
  };

  if (!me.data) return <p className="text-ink-500 text-sm font-light">Loading…</p>;

  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          name,
          jobTitle,
          phones: phones
            .filter((phone) => phone.number.trim())
            .map(({ number, kind }) => ({ number, kind })),
        });
      }}
    >
      <Fieldset title="About you" description="How your colleagues see you in the team directory and in chat.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => {
                setSaved(false);
                setName(e.target.value);
              }}
              placeholder="Anna Muster"
            />
          </Field>
          <Field label="Job title">
            <Input
              value={jobTitle}
              onChange={(e) => {
                setSaved(false);
                setJobTitle(e.target.value);
              }}
              placeholder="Account manager"
            />
          </Field>
          <Field
            label="Email"
            hint="This is the Google account you sign in with, so it cannot be changed here."
            className="sm:col-span-2"
          >
            <Input value={me.data.email ?? ""} disabled readOnly />
          </Field>
        </div>
      </Fieldset>

      <Fieldset
        title="Phone numbers"
        description="Add as many as you like, and say whether each one takes calls, WhatsApp, or both. List the one to try first at the top."
      >
        <div className="space-y-3">
          {phones.length === 0 && (
            <p className="text-ink-500 text-sm font-light">No phone numbers yet.</p>
          )}
          {phones.map((phone) => (
            <div key={phone.key} className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-48 flex-1"
                type="tel"
                value={phone.number}
                onChange={(e) => change(phone.key, { number: e.target.value })}
                placeholder="+41 79 123 45 67"
                aria-label="Phone number"
              />
              <Select
                className="w-auto"
                value={phone.kind}
                onChange={(e) => change(phone.key, { kind: e.target.value as PhoneKind })}
                aria-label="What this number is for"
              >
                {phoneKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {phoneKindLabels[kind]}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSaved(false);
                  setPhones((list) => list.filter((item) => item.key !== phone.key));
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSaved(false);
              setPhones((list) => [...list, { key: nextKey++, number: "", kind: "MOBILE" }]);
            }}
          >
            + Add a number
          </Button>
        </div>
      </Fieldset>

      <FormError message={friendlyError(save.error)} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
        {saved && <span className="text-sm font-light text-[#0d8f5d]">Saved.</span>}
      </div>
    </form>
  );
}

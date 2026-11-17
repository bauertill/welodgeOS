"use client";

import { useEffect, useRef, useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Button } from "~/app/_components/form";
import { MentionTextarea } from "~/app/_components/mention-textarea";
import { extrasInput, noExtras, UpdateExtras, UpdateList, type Extras } from "~/app/_components/update-thread";
import { useRemembered } from "~/lib/remembered";
import { api } from "~/trpc/react";

/**
 * The Updates board (doc §2.6, the team 2026-11-17): what the whole team
 * should see, or what was said before, in one place — as monday's updates
 * were, at the provider or the property level. Four tabs; each update is the
 * same one shown on its property's, chain's, client's or request's page, and
 * links there. A red dot marks a tab with something new since you last looked.
 */
const TABS = [
  { key: "CLIENT", label: "Client", hint: "Updates on clients and their requests." },
  { key: "ACCOMMODATION", label: "Accommodation", hint: "Updates on properties and hotel chains." },
  { key: "OTHER", label: "Other providers", hint: "Housekeeping, furniture rental and the rest — by name." },
  { key: "TEAM", label: "For the team", hint: "For everyone, about nothing in particular." },
] as const;
type Tab = (typeof TABS)[number]["key"];

export function UpdateBoard({ initialTab }: { initialTab?: string }) {
  const utils = api.useUtils();
  const [tab, setTab, tabReady] = useRemembered<Tab>(
    "updates:tab",
    "TEAM",
    TABS.some((entry) => entry.key === initialTab) ? (initialTab as Tab) : undefined,
  );
  const fresh = api.update.boardNew.useQuery(undefined, { refetchInterval: 60_000 });
  const options = api.update.boardOptions.useQuery();
  const people = api.user.list.useQuery();

  // Filters, per tab, kept until reset.
  const [propertyId, setPropertyId] = useRemembered("updates:property", "");
  const [providerId, setProviderId] = useRemembered("updates:chain", "");
  const [clientId, setClientId] = useRemembered("updates:client", "");
  const [otherName, setOtherName] = useRemembered("updates:other", "");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(30);
  const filters = {
    tab,
    search: search.trim() || undefined,
    limit,
    ...(tab === "ACCOMMODATION" ? { propertyId: propertyId || undefined, providerId: providerId || undefined } : {}),
    ...(tab === "CLIENT" ? { clientId: clientId || undefined } : {}),
    ...(tab === "OTHER" ? { otherProvider: otherName || undefined } : {}),
  };
  const board = api.update.board.useQuery(filters);

  // What was new when the tab was opened stays marked New while you read it.
  const [newSince, setNewSince] = useState<Date | null>(null);
  const markSeen = api.update.markSeen.useMutation({ onSuccess: () => void utils.update.boardNew.invalidate() });
  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!tabReady || !fresh.data || markedFor.current === tab) return;
    markedFor.current = tab;
    setNewSince(fresh.data[tab].since);
    markSeen.mutate({ tab });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per tab opened
  }, [tab, tabReady, fresh.data]);

  // Something new on the tab you are reading is seen already.
  useEffect(() => {
    if (tabReady && markedFor.current === tab && (fresh.data?.[tab].count ?? 0) > 0 && !markSeen.isPending) markSeen.mutate({ tab });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the counts change
  }, [fresh.data]);

  // Writing one: about any of these, or none — for the team.
  const [body, setBody] = useState("");
  const [about, setAbout] = useState({ propertyId: "", providerId: "", clientId: "", otherProvider: "" });
  const [extras, setExtras] = useState<Extras>(noExtras);
  useEffect(() => {
    // Starting a new one on a tab starts it about what the tab is filtered to.
    setAbout({
      propertyId: tab === "ACCOMMODATION" ? propertyId : "",
      providerId: tab === "ACCOMMODATION" ? providerId : "",
      clientId: tab === "CLIENT" ? clientId : "",
      otherProvider: tab === "OTHER" ? otherName : "",
    });
  }, [tab, propertyId, providerId, clientId, otherName]);
  const post = api.update.post.useMutation({
    onSuccess: () => {
      setBody("");
      setExtras(noExtras);
      void utils.update.invalidate();
    },
  });
  const landsOn = [
    about.clientId ? "Client" : null,
    about.propertyId || about.providerId ? "Accommodation" : null,
    about.otherProvider.trim() ? "Other providers" : null,
  ].filter(Boolean);

  const propertyOptions = (options.data?.properties ?? []).map((property) => ({ id: property.id, label: property.name, detail: property.city }));
  const chainOptions = (options.data?.providers ?? []).map((provider) => ({ id: provider.id, label: provider.name }));
  const clientOptions = (options.data?.clients ?? []).map((client) => ({ id: client.id, label: client.name, detail: client.shortName }));
  const filtered = Boolean(search.trim() || (tab === "ACCOMMODATION" && (propertyId || providerId)) || (tab === "CLIENT" && clientId) || (tab === "OTHER" && otherName));
  const pill = (active: boolean) =>
    `relative -mb-px flex items-center gap-1.5 border-b-2 px-4 pt-1.5 pb-2.5 text-[14px] whitespace-nowrap transition-colors ${
      active ? "border-ink-900 text-ink-900 font-medium" : "text-ink-500 hover:text-ink-900 border-transparent font-light"
    }`;

  return (
    <div className="max-w-4xl space-y-5">
      <div role="tablist" className="border-ink-200/60 flex gap-1 overflow-x-auto border-b">
        {TABS.map((entry) => {
          const count = fresh.data?.[entry.key].count ?? 0;
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              onClick={() => {
                setTab(entry.key);
                setLimit(30);
              }}
              className={pill(tab === entry.key)}
            >
              {entry.label}
              {count > 0 && tab !== entry.key && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e0234e] px-1.5 text-[11px] font-medium text-white" title={`${count} new`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Write one */}
      <div className="border-ink-200/60 rounded-xl border bg-white p-4">
        <MentionTextarea value={body} onChange={setBody} people={people.data ?? []} placeholder="Write an update — @ to mention a colleague" rows={body ? 3 : 1} />
        {body.trim() && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Combobox value={about.propertyId} onChange={(id) => setAbout({ ...about, propertyId: id })} options={propertyOptions} placeholder="About a property…" />
              <Combobox value={about.providerId} onChange={(id) => setAbout({ ...about, providerId: id })} options={chainOptions} placeholder="About a hotel chain…" />
              <Combobox value={about.clientId} onChange={(id) => setAbout({ ...about, clientId: id })} options={clientOptions} placeholder="About a client…" />
              <input
                list="other-providers"
                value={about.otherProvider}
                onChange={(e) => setAbout({ ...about, otherProvider: e.target.value })}
                placeholder="About another provider — Housekeeping Burbank…"
                className="border-ink-200 rounded-lg border bg-white px-3 py-2 text-sm font-light outline-none"
              />
              <datalist id="other-providers">
                {(options.data?.otherProviders ?? []).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <UpdateExtras value={extras} onChange={setExtras} people={people.data ?? []} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-ink-500 text-xs font-light">
                Shows on {landsOn.length ? landsOn.join(" and ") : "For the team"}
                {about.propertyId || about.providerId || about.clientId ? ", and on the page of what it is about" : ""}.
              </span>
              {post.error && <span className="text-xs text-[#c03654]">{post.error.message}</span>}
              <Button
                type="button"
                className="ml-auto"
                disabled={post.isPending}
                onClick={() =>
                  post.mutate({
                    body,
                    kind: "NOTE",
                    propertyId: about.propertyId || undefined,
                    providerId: about.providerId || undefined,
                    clientId: about.clientId || undefined,
                    otherProvider: about.otherProvider.trim() || undefined,
                    ...extrasInput(extras),
                  })
                }
              >
                {post.isPending ? "Posting…" : "Post update"}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Narrow the tab */}
      <div className="flex flex-wrap items-center gap-2">
        {tab === "CLIENT" && <Combobox className="w-72" value={clientId} onChange={setClientId} options={clientOptions} placeholder="Every client" />}
        {tab === "ACCOMMODATION" && (
          <>
            <Combobox className="w-72" value={propertyId} onChange={setPropertyId} options={propertyOptions} placeholder="Every property" />
            <Combobox className="w-60" value={providerId} onChange={setProviderId} options={chainOptions} placeholder="Every hotel chain" />
          </>
        )}
        {tab === "OTHER" && (
          <select
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
            className="border-ink-200 rounded-lg border bg-white px-3 py-2 text-sm font-light"
            aria-label="Provider"
          >
            <option value="">Every provider</option>
            {(options.data?.otherProviders ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the text…"
          aria-label="Search"
          className="border-ink-200 w-56 rounded-lg border bg-white px-3 py-2 text-sm font-light outline-none"
        />
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setPropertyId("");
              setProviderId("");
              setClientId("");
              setOtherName("");
            }}
            className="text-brand-700 text-[13px] font-light hover:underline"
          >
            Reset filters
          </button>
        )}
        <span className="text-ink-500 ml-auto text-xs font-light">{TABS.find((entry) => entry.key === tab)!.hint}</span>
      </div>

      {board.isLoading ? (
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      ) : (
        <UpdateList
          updates={board.data?.updates}
          empty={filtered ? "Nothing matches these filters." : "Nothing here yet."}
          hasMore={board.data?.more}
          onMore={() => setLimit((current) => current + 30)}
          newSince={newSince}
        />
      )}
    </div>
  );
}

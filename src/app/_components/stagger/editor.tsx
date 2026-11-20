"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Field, FormError, friendlyError, Input } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { StaggerBand, StaggerBody, StaggerFrame, StaggerPanel } from "~/app/_components/stagger/planner";
import { formatDate } from "~/lib/format";
import { compute, type StaggerData } from "~/lib/stagger-model";
import { api, type RouterOutputs } from "~/trpc/react";

type Scenario = NonNullable<RouterOutputs["stagger"]["byId"]>;
type ListRow = RouterOutputs["stagger"]["list"][number];

const shareUrl = (token: string) => `${window.location.origin}/stagger/view/${token}`;
const who = (person?: { name: string | null; email: string | null } | null) => person?.name ?? person?.email ?? "someone";
const when = (date: Date) => `${formatDate(date)} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

/** "Hide settings" is each viewer's own, remembered in their browser — never saved to the scenario. */
function usePresenting(id: string) {
  const key = `stagger:${id}:presenting`;
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    try {
      setPresenting(localStorage.getItem(key) === "1");
    } catch {
      /* private window: start with settings shown */
    }
  }, [key]);
  const toggle = () =>
    setPresenting((on) => {
      try {
        localStorage.setItem(key, on ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !on;
    });
  return [presenting, toggle] as const;
}

type Status = "saved" | "dirty" | "saving" | "conflict" | "error";

/**
 * The editor (doc §4.12): the whole reference page with its settings, saved
 * as you go — 600 ms after the last change. Each save names the version it
 * was made from; if a colleague saved in between, nothing is overwritten and
 * the editor asks to reload.
 */
export function StaggerEditor({ scenario }: { scenario: Scenario }) {
  const [data, setData] = useState<StaggerData>(scenario.data);
  const [meta, setMeta] = useState({ name: scenario.name, event: scenario.event ?? "", clientLabel: scenario.clientLabel ?? "" });
  const [status, setStatus] = useState<Status>("saved");
  const [problem, setProblem] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{ at: Date; by: string }>({ at: scenario.updatedAt, by: who(scenario.updatedBy) });
  const [presenting, togglePresenting] = usePresenting(scenario.id);
  const [sharing, setSharing] = useState(false);
  const c = useMemo(() => compute(data), [data]);

  // What the server last confirmed, and what is waiting to go.
  const seen = useRef<Date>(scenario.updatedAt);
  const pending = useRef<{ data: StaggerData; meta: typeof meta } | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  const save = api.stagger.update.useMutation();

  const flush = useCallback(async () => {
    if (inFlight.current || !pending.current || stopped.current) return;
    const next = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus("saving");
    try {
      const row = await save.mutateAsync({ id: scenario.id, seen: seen.current, data: next.data, name: next.meta.name.trim() || scenario.name, event: next.meta.event, clientLabel: next.meta.clientLabel });
      seen.current = row.updatedAt;
      setLastSaved({ at: row.updatedAt, by: who(row.updatedBy) });
      inFlight.current = false;
      if (pending.current) void flush();
      else setStatus("saved");
    } catch (error) {
      inFlight.current = false;
      const code = (error as { data?: { code?: string } }).data?.code;
      if (code === "CONFLICT") {
        stopped.current = true;
        setStatus("conflict");
        setProblem((error as Error).message);
      } else {
        pending.current = pending.current ?? next;
        setStatus("error");
        setProblem(friendlyError(error as Parameters<typeof friendlyError>[0]) ?? "Not saved.");
      }
    }
  }, [save, scenario.id, scenario.name]);

  const queue = (nextData: StaggerData, nextMeta: typeof meta) => {
    if (stopped.current) return;
    pending.current = { data: nextData, meta: nextMeta };
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  };
  const change = (next: StaggerData) => {
    setData(next);
    queue(next, meta);
  };
  const changeMeta = (patch: Partial<typeof meta>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    queue(data, next);
  };

  // Warn before leaving with a change not yet saved.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const owner = meta.clientLabel.trim() || "the owner";
  const statusText =
    status === "saving" ? "Saving…" : status === "dirty" ? "Unsaved changes…" : status === "conflict" ? "Not saved" : status === "error" ? "Not saved — retrying on your next change" : `Saved · ${when(lastSaved.at)} by ${lastSaved.by}`;

  return (
    <div className="-mx-6 -my-8">
      <div className="border-ink-200/60 flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3 md:px-8 print:hidden">
        <Link href="/stagger" className="text-ink-500 hover:text-brand-700 text-[13px]">
          ← All scenarios
        </Link>
        <input
          value={meta.name}
          onChange={(e) => changeMeta({ name: e.target.value })}
          aria-label="Scenario name"
          className="text-ink-900 hover:border-ink-200 focus:border-brand-400 min-w-48 flex-1 rounded-md border border-transparent px-2 py-1 text-[15px] font-medium outline-none"
        />
        <input
          value={meta.clientLabel}
          onChange={(e) => changeMeta({ clientLabel: e.target.value })}
          placeholder="Owner, e.g. Decron Properties"
          aria-label="Owner"
          className="border-ink-200 focus:border-brand-400 w-52 rounded-md border px-2 py-1 text-[13px] outline-none"
        />
        <input
          value={meta.event}
          onChange={(e) => changeMeta({ event: e.target.value })}
          placeholder="Event, e.g. LA28"
          aria-label="Event"
          className="border-ink-200 focus:border-brand-400 w-28 rounded-md border px-2 py-1 text-[13px] outline-none"
        />
        <span role="status" aria-live="polite" className={`text-[12px] font-light ${status === "conflict" || status === "error" ? "text-[#c03654]" : "text-ink-500"}`}>
          {statusText}
        </span>
        <Button type="button" variant="secondary" onClick={() => setSharing(true)}>
          Share link
        </Button>
      </div>
      {status === "conflict" && (
        <div className="flex flex-wrap items-center gap-3 bg-[#fde8ec] px-4 py-3 text-[13px] text-[#a3243d] md:px-8 print:hidden">
          <span className="font-medium">{problem ?? "Someone else changed this scenario – reload."}</span>
          <span className="font-light">Your latest change was not saved, so nothing of theirs was overwritten.</span>
          <button type="button" onClick={() => window.location.reload()} className="ml-auto rounded-full bg-[#a3243d] px-4 py-1.5 font-medium text-white">
            Reload
          </button>
        </div>
      )}
      <StaggerFrame presenting={presenting}>
        <StaggerBand owner={owner} presenting={presenting} onToggle={togglePresenting} />
        <div className="wrap">
          <StaggerBody data={data} owner={owner} c={c} />
          <StaggerPanel data={data} owner={owner} onChange={change} />
        </div>
      </StaggerFrame>
      {sharing && <ShareDialog id={scenario.id} initial={{ shareEnabled: scenario.shareEnabled, shareToken: scenario.shareToken }} onClose={() => setSharing(false)} />}
    </div>
  );
}

/** The owner's read-only link: on or off, copied, or replaced so the old one stops working. */
export function ShareDialog({ id, initial, onClose }: { id: string; initial: { shareEnabled: boolean; shareToken: string | null }; onClose: () => void }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [state, setState] = useState(initial);
  const [copied, setCopied] = useState(false);
  const share = api.stagger.share.useMutation({
    onSuccess: (row) => {
      setState(row);
      setCopied(false);
      void utils.stagger.invalidate();
      router.refresh();
    },
  });
  const link = state.shareEnabled && state.shareToken ? shareUrl(state.shareToken) : null;
  return (
    <Popup size="medium" title="Share with the owner" subtitle="A read-only page of this scenario, with the settings hidden. Anyone with the link can open it; it updates as the scenario changes." onClose={onClose}>
      <div className="space-y-4 rounded-xl bg-white p-5 text-[13px]">
        {link ? (
          <>
            <Field label="The link">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(link).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => window.open(link, "_blank")}>
                Open it
              </Button>
              <Button type="button" variant="secondary" disabled={share.isPending} onClick={() => window.confirm("Make a new link? The current one stops working at once.") && share.mutate({ id, enabled: true, regenerate: true })}>
                New link
              </Button>
              <Button type="button" variant="danger" className="ml-auto" disabled={share.isPending} onClick={() => share.mutate({ id, enabled: false })}>
                Stop sharing
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-ink-700 font-light">Not shared. Turning it on makes a link to send the owner — it shows only the owner&apos;s rent, never our prices or costs.</p>
            <Button type="button" disabled={share.isPending} onClick={() => share.mutate({ id, enabled: true })}>
              Turn on the share link
            </Button>
          </>
        )}
        <FormError message={share.error ? friendlyError(share.error) : null} />
      </div>
    </Popup>
  );
}

/** Sales › Stagger planner (doc §4.12): every scenario, last edited first. */
export function StaggerList() {
  const router = useRouter();
  const utils = api.useUtils();
  const [archived, setArchived] = useState(false);
  const list = api.stagger.list.useQuery({ archived });
  const [making, setMaking] = useState(false);
  const [sharing, setSharing] = useState<ListRow | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const refresh = () => void utils.stagger.invalidate();
  const duplicate = api.stagger.duplicate.useMutation({ onSuccess: refresh });
  const archive = api.stagger.archive.useMutation({ onSuccess: refresh });
  const rename = api.stagger.update.useMutation({ onSuccess: refresh });
  const problem = duplicate.error ?? archive.error ?? rename.error;

  const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2.5 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
  const td = "border-ink-200/40 border-b px-3 py-2.5 align-top text-[13px] font-light";
  const action = "text-brand-700 text-xs whitespace-nowrap hover:underline";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-ink-700 flex items-center gap-2 text-[13px] font-light">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="accent-brand-500" />
          Show archived
        </label>
        <span className="ml-auto">
          <Button type="button" onClick={() => setMaking(true)}>
            + New scenario
          </Button>
        </span>
      </div>
      <FormError message={problem ? friendlyError(problem) : null} />
      {list.isLoading ? (
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      ) : !list.data?.length ? (
        <p className="text-ink-500 text-sm font-light">{archived ? "Nothing archived." : "No scenarios yet. Make one with + New scenario."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className={`${th} pl-4`}>Scenario</th>
                <th className={th}>Owner</th>
                <th className={th}>Event</th>
                <th className={th}>Units</th>
                <th className={th}>Last edited</th>
                <th className={th}>Share link</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.data.map((row) => (
                <tr key={row.id} className="hover:bg-brand-50/40">
                  <td className={`${td} text-ink-900 pl-4 font-medium`}>
                    <Link href={`/stagger/${row.id}`} className="hover:text-brand-700">
                      {row.name}
                    </Link>
                  </td>
                  <td className={td}>{row.clientLabel ?? "—"}</td>
                  <td className={td}>{row.event ?? "—"}</td>
                  <td className={td}>{row.units}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {when(row.updatedAt)}
                    <span className="text-ink-500 block text-xs">{row.updatedBy ? who(row.updatedBy) : "—"}</span>
                  </td>
                  <td className={td}>
                    {row.shareEnabled && row.shareToken ? (
                      <button
                        type="button"
                        className={action}
                        onClick={() => {
                          void navigator.clipboard.writeText(shareUrl(row.shareToken!)).then(() => setCopied(row.id));
                        }}
                      >
                        {copied === row.id ? "Copied" : "Copy link"}
                      </button>
                    ) : (
                      <span className="text-ink-500">Not shared</span>
                    )}
                    {!row.archived && (
                      <button type="button" className="text-ink-500 ml-2 text-xs hover:underline" onClick={() => setSharing(row)}>
                        Manage
                      </button>
                    )}
                  </td>
                  <td className={`${td} space-x-3 text-right whitespace-nowrap`}>
                    {!row.archived && (
                      <>
                        <button type="button" className={action} onClick={() => router.push(`/stagger/${row.id}`)}>
                          Open
                        </button>
                        <button type="button" className={action} disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: row.id })}>
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className={action}
                          onClick={() => {
                            const name = window.prompt("Rename the scenario", row.name);
                            if (name?.trim() && name.trim() !== row.name) rename.mutate({ id: row.id, seen: row.updatedAt, name: name.trim() });
                          }}
                        >
                          Rename
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={action}
                      onClick={() => {
                        if (row.archived) archive.mutate({ id: row.id, archived: false });
                        else if (window.confirm(`Archive "${row.name}"? Its share link stops working; it can be brought back from Show archived.`)) archive.mutate({ id: row.id, archived: true });
                      }}
                    >
                      {row.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {making && <NewScenario onClose={() => setMaking(false)} />}
      {sharing && (
        <ShareDialog
          id={sharing.id}
          initial={{ shareEnabled: sharing.shareEnabled, shareToken: sharing.shareToken }}
          onClose={() => {
            setSharing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function NewScenario({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clientLabel, setClientLabel] = useState("");
  const [event, setEvent] = useState("LA28");
  const create = api.stagger.create.useMutation({ onSuccess: (row) => router.push(`/stagger/${row.id}`) });
  return (
    <Popup size="medium" title="New scenario" subtitle="It starts at the 50-unit scenario and opens straight after, to set the waves, mix and rent." onClose={onClose}>
      <form
        className="space-y-4 rounded-xl bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name, clientLabel, event });
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Decron – OBS 100 units" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner">
            <Input value={clientLabel} onChange={(e) => setClientLabel(e.target.value)} placeholder="Decron Properties" />
          </Field>
          <Field label="Event">
            <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="LA28" />
          </Field>
        </div>
        <FormError message={create.error ? friendlyError(create.error) : null} />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Making it…" : "Make the scenario"}
        </Button>
      </form>
    </Popup>
  );
}

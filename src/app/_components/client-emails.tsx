"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Select } from "~/app/_components/form";
import { formatMomentInWords } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * Emails with a client (doc §4.10), read-only, newest first — on a sales
 * request, and on the client's page with a choice of one contact. Opening it
 * brings the team's connected mailboxes up to date (each at most every ten
 * minutes); *Sync now* does it at once.
 */

type Email = RouterOutputs["email"]["forClient"][number];

export function ClientEmails({ salesRequestId, clientId, contacts }: { salesRequestId?: string; clientId?: string; contacts?: { id: string; name: string; email: string | null }[] }) {
  const utils = api.useUtils();
  const [contactId, setContactId] = useState("");
  const byRequest = api.email.forRequest.useQuery({ id: salesRequestId ?? "" }, { enabled: Boolean(salesRequestId) });
  const byClient = api.email.forClient.useQuery({ clientId: clientId ?? "", contactId: contactId || undefined }, { enabled: Boolean(clientId) });
  const emails = salesRequestId ? byRequest : byClient;
  const connected = api.email.connectedCount.useQuery();
  const refresh = api.email.refresh.useMutation({ onSettled: () => void utils.email.invalidate() });
  // Once per opening: fetch what is new since the last sync.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    refresh.mutate({ force: false });
  }, [refresh]);
  const rows = emails.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-500 text-xs font-light">
          {rows.length} {rows.length === 1 ? "email" : "emails"} with {clientId && contactId ? "this contact" : "the client's contacts"}, from{" "}
          {connected.data ?? "…"} connected {connected.data === 1 ? "mailbox" : "mailboxes"} · read-only
          {refresh.isPending && " · checking for new ones…"}
        </p>
        <div className="flex items-center gap-3">
          {clientId && contacts && contacts.length > 1 && (
            <div className="w-56">
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Whose emails" className="py-1 text-xs">
                <option value="">Every contact</option>
                {contacts
                  .filter((contact) => contact.email)
                  .map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          <button type="button" disabled={refresh.isPending} onClick={() => refresh.mutate({ force: true })} className="text-brand-700 text-[13px] font-medium hover:underline">
            {refresh.isPending ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">
          {emails.isLoading
            ? "…"
            : connected.data === 0
              ? "No emails yet — nobody has connected their Gmail. Connect yours on My profile → Gmail."
              : "No emails with the client's contacts in the connected mailboxes yet. An email shows here once its sender or a recipient is one of the client's contacts."}{" "}
          {connected.data === 0 && (
            <Link href="/team/profile#gmail" className="text-brand-700 hover:underline">
              My profile →
            </Link>
          )}
        </p>
      ) : (
        <ul className="divide-ink-200/60 border-ink-200/60 divide-y rounded-xl border">
          {rows.map((email) => (
            <EmailRow key={email.id} email={email} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailRow({ email }: { email: Email }) {
  const [open, setOpen] = useState(false);
  const to = [...email.to, ...email.cc];
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={() => setOpen(!open)} className="block w-full text-left" aria-expanded={open}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ink-900 min-w-0 truncate text-[13px] font-medium">
            {email.fromName ?? email.fromEmail}
            <span className="text-ink-500 font-light"> → {to.slice(0, 2).join(", ")}{to.length > 2 ? ` +${to.length - 2}` : ""}</span>
          </span>
          <span className="text-ink-500 shrink-0 text-xs font-light" title={email.sentAt.toLocaleString()}>
            {formatMomentInWords(email.sentAt)}
          </span>
        </div>
        <p className="text-ink-900 truncate text-sm">{email.subject ?? "(no subject)"}</p>
        {!open && email.snippet && <p className="text-ink-500 truncate text-xs font-light">{email.snippet}</p>}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-ink-500 text-xs font-light">
            From {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail} · to {email.to.join(", ") || "—"}
            {email.cc.length > 0 && ` · cc ${email.cc.join(", ")}`} · {email.sentAt.toLocaleString()}
          </p>
          <div className="bg-ink-50/60 text-ink-900 max-h-[32rem] overflow-y-auto rounded-lg px-3 py-2 text-[13px] font-light whitespace-pre-wrap">
            {email.bodyText ?? email.snippet ?? "(no text)"}
          </div>
          {email.attachmentNames.length > 0 && <p className="text-ink-500 text-xs font-light">📎 {email.attachmentNames.join(", ")} — open them in Gmail</p>}
          <p className="text-ink-500 text-xs font-light">
            From {email.foundIn.map((copy) => `${copy.name}'s mailbox`).join(" and ")}
            {email.foundIn.some((copy) => copy.openInGmail) && (
              <>
                {" · "}
                <a href={email.foundIn.find((copy) => copy.openInGmail)!.openInGmail!} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                  Open in Gmail ↗
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </li>
  );
}

/** On My profile: connecting my Gmail, read-only (doc §4.10). */
export function GmailCard({ outcome }: { outcome?: string }) {
  const utils = api.useUtils();
  const mine = api.email.mine.useQuery();
  const disconnect = api.email.disconnect.useMutation({ onSuccess: () => void utils.email.invalidate() });
  const sync = api.email.syncMine.useMutation({ onSettled: () => void utils.email.invalidate() });
  const connection = mine.data?.connection;
  const said: Record<string, string> = {
    connected: "✓ Gmail connected — your last month of emails with clients is coming in.",
    cancelled: "Connecting was cancelled at Google.",
    expired: "That took too long — try Connect Gmail again.",
    "no-key": "Google did not give a key to keep — try again; if it repeats, disconnect WeLodge OS in your Google account and connect again.",
    failed: "Google refused — try again, or tell Till.",
    "not-set-up": "Gmail is not switched on for WeLodge OS yet — Till has to switch it on in Google Cloud.",
  };
  return (
    <div id="gmail" className="border-ink-200/60 mb-8 rounded-xl border bg-white p-5">
      <h2 className="text-ink-900 text-[15px] font-medium">Gmail</h2>
      <p className="text-ink-500 mt-1 mb-3 text-sm font-light">
        Connect your Gmail and your emails with clients show on their sales requests and pages, for the whole team — read-only, like monday&rsquo;s emails.
        Only emails to or from a client&rsquo;s contacts are brought in; nothing else in your mailbox is read, and nothing is ever sent, changed or deleted.
      </p>
      {outcome && said[outcome] && <p className="mb-3 text-[13px] text-[#0a7a47]">{said[outcome]}</p>}
      {mine.data && !mine.data.configured ? (
        <p className="text-ink-500 text-sm font-light">{said["not-set-up"]}</p>
      ) : connection ? (
        <div className="space-y-2 text-sm font-light">
          <p>
            <span className="font-medium">✓ {connection.email}</span> · connected {formatMomentInWords(connection.connectedAt)} · {connection._count.copies} emails brought in
            {connection.lastSyncedAt ? ` · last synced ${formatMomentInWords(connection.lastSyncedAt)}` : " · first sync under way"}
          </p>
          {connection.lastError && <p className="text-xs text-[#c03654]">The last sync failed: {connection.lastError}</p>}
          <div className="flex gap-4 text-[13px]">
            <button type="button" disabled={sync.isPending} onClick={() => sync.mutate()} className="text-brand-700 font-medium hover:underline">
              {sync.isPending ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              disabled={disconnect.isPending}
              onClick={() => window.confirm("Disconnect your Gmail? Nothing more is read; the emails already brought in stay for the team.") && disconnect.mutate()}
              className="text-[#c03654] hover:underline"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <a href="/api/gmail/connect" className="bg-brand-400 hover:bg-brand-500 inline-block rounded-full px-5 py-2 text-[13px] font-medium text-white">
          Connect Gmail
        </a>
      )}
    </div>
  );
}

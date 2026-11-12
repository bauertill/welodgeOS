"use client";

import Link from "next/link";

import { Manager } from "~/app/_components/client-list";
import { Popup } from "~/app/_components/popup";
import { StageBadge, WaitingBadge } from "~/app/_components/sales-requests";
import { clientCategoryLabels, contactTypeLabels } from "~/lib/clients";
import { isClosed } from "~/lib/sales";
import { api } from "~/trpc/react";

/**
 * A client at a glance, from the Clients list (doc §4.10, the owner 2026-11-12):
 * its people and its open sales requests, with the full page a click away.
 */
export function ClientQuickView({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const client = api.clients.byId.useQuery({ id: clientId });
  const requests = api.sales.forClient.useQuery({ clientId });
  const open = (requests.data ?? []).filter((request) => !isClosed(request.stage));
  const data = client.data;
  const h3 = "text-ink-900 mb-2 text-[15px] font-medium";

  return (
    <Popup
      size="medium"
      onClose={onClose}
      title={data?.name ?? "…"}
      subtitle={
        data
          ? [data.category ? clientCategoryLabels[data.category] : null, data.shortName].filter(Boolean).join(" · ") || undefined
          : undefined
      }
      aside={
        <Link href={`/clients/${clientId}`} className="bg-brand-600 hover:bg-brand-700 rounded-full px-4 py-1.5 text-sm font-medium text-white">
          View full page
        </Link>
      }
    >
      {data?.accountManager && (
        <p className="text-ink-500 -mt-3 mb-4 flex items-center gap-2 text-sm font-light">
          Account manager <Manager person={data.accountManager} />
        </p>
      )}

      <section className="mb-5 rounded-xl bg-white p-4">
        <h3 className={h3}>Open sales requests</h3>
        {requests.isLoading ? (
          <p className="text-ink-500 text-sm font-light">…</p>
        ) : open.length === 0 ? (
          <p className="text-ink-500 text-sm font-light">None open.</p>
        ) : (
          <ul className="divide-ink-200/60 divide-y">
            {open.map((request) => (
              <li key={request.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/sales/${request.id}`} className="hover:text-brand-700 text-sm font-medium">
                    {request.event?.name ?? "No event"}
                    {request.contact ? ` · ${request.contact.name}` : ""}
                  </Link>
                  <span className="text-ink-500 line-clamp-1 block text-xs font-light">{request.description ?? request.rooms ?? "—"}</span>
                </div>
                <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <WaitingBadge waitingOn={request.waitingOn} />
                  <StageBadge stage={request.stage} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white p-4">
        <h3 className={h3}>
          Contacts{data ? <span className="text-ink-500 ml-1.5 font-light">{data.contacts.length}</span> : null}
        </h3>
        {!data ? (
          <p className="text-ink-500 text-sm font-light">…</p>
        ) : data.contacts.length === 0 ? (
          <p className="text-ink-500 text-sm font-light">No contacts yet.</p>
        ) : (
          <ul className="divide-ink-200/60 divide-y">
            {data.contacts.map((contact) => (
              <li key={contact.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-ink-900 font-medium">
                    {contact.name}
                    {contact.title && <span className="text-ink-500 font-light"> · {contact.title}</span>}
                  </span>
                  {contact.type && <span className="text-ink-500 text-xs font-light">{contactTypeLabels[contact.type]}</span>}
                </div>
                <div className="text-ink-500 mt-0.5 flex flex-wrap gap-x-4 text-xs font-light">
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-brand-700 hover:underline">
                      {contact.email}
                    </a>
                  )}
                  {contact.mobile && <span>{contact.mobile}</span>}
                  {contact.phone && <span>{contact.phone}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Popup>
  );
}

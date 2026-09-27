"use client";

import { useRouter } from "next/navigation";

import { Button } from "~/app/_components/form";
import { CustomStatusText } from "~/app/_components/status-dialog";
import { Card, EmptyState, Pill } from "~/app/_components/ui";
import { formatUntil } from "~/lib/format";
import { personName, phoneKindLabels, presenceLabels, presencePollMs, type Presence } from "~/lib/team";
import { api } from "~/trpc/react";

/** Everyone in We Lodge and how to reach them (doc §2.7). */
export function TeamDirectory({ myId }: { myId: string }) {
  const router = useRouter();
  const people = api.user.directory.useQuery(undefined, { refetchInterval: presencePollMs });
  const openDirect = api.chat.openDirect.useMutation({
    onSuccess: ({ id }) => router.push(`/messages/${id}`),
  });

  if (!people.data) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  if (people.data.length === 0) {
    return <EmptyState title="Nobody here yet" description="Colleagues appear once they have signed in." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {people.data.map((person) => (
        <Card key={person.id} className="flex flex-col">
          <div className="flex items-start gap-3">
            <Avatar name={personName(person)} image={person.image} presence={person.presence} />
            <div className="min-w-0">
              <p className="text-ink-900 font-medium">
                {personName(person)}
                {person.id === myId && <span className="text-ink-500 font-light"> (you)</span>}
              </p>
              <p className="text-ink-500 text-xs font-light">
                {presenceLabels[person.presence]}
                {person.presenceUntil && ` · ${formatUntil(person.presenceUntil)}`}
              </p>
              <CustomStatusText
                status={person.customStatus}
                showUntil
                className="text-ink-700 mt-1 max-w-full text-xs font-light"
              />
              {person.jobTitle && (
                <p className="text-ink-500 text-sm font-light">{person.jobTitle}</p>
              )}
            </div>
          </div>

          <dl className="mt-4 space-y-2 text-sm font-light">
            {person.email && (
              <div>
                <dt className="sr-only">Email</dt>
                <dd>
                  <a href={`mailto:${person.email}`} className="text-brand-700 break-all hover:underline">
                    {person.email}
                  </a>
                </dd>
              </div>
            )}
            {person.phones.map((phone) => (
              <div key={phone.id} className="flex flex-wrap items-center gap-2">
                <dt className="sr-only">{phoneKindLabels[phone.kind]}</dt>
                <dd className="text-ink-700">{phone.number}</dd>
                <Pill>{phoneKindLabels[phone.kind]}</Pill>
              </div>
            ))}
            {person.phones.length === 0 && (
              <p className="text-ink-500">No phone number yet.</p>
            )}
          </dl>

          {person.id !== myId && (
            <div className="mt-auto pt-4">
              <Button
                type="button"
                variant="secondary"
                disabled={openDirect.isPending}
                onClick={() => openDirect.mutate({ userId: person.id })}
              >
                Message
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

export function Avatar({
  name,
  image,
  size = "md",
  presence,
}: {
  name: string;
  image?: string | null;
  size?: "sm" | "md";
  presence?: Presence;
}) {
  const dimensions = size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-[13px]";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span className="relative inline-flex shrink-0">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a Google profile photo, already sized
        <img src={image} alt="" className={`${dimensions} rounded-full object-cover`} />
      ) : (
        <span
          aria-hidden="true"
          className={`${dimensions} bg-brand-50 text-brand-700 inline-flex items-center justify-center rounded-full font-medium`}
        >
          {initials}
        </span>
      )}
      {presence && (
        <PresenceDot presence={presence} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-white" />
      )}
    </span>
  );
}

const dotStyles: Record<Presence, string> = {
  ACTIVE: "bg-[#12b878]",
  AWAY: "bg-white border-2 border-ink-500",
  AT_LUNCH: "bg-[#e0a02a]",
  DONE_FOR_THE_DAY: "bg-ink-500",
  DO_NOT_DISTURB: "bg-[#db4b68] after:absolute after:inset-x-[3px] after:top-1/2 after:h-[2px] after:-translate-y-1/2 after:rounded after:bg-white",
};

/** A colleague's status as a coloured dot, named for screen readers and on hover. */
export function PresenceDot({ presence, className = "" }: { presence: Presence; className?: string }) {
  return (
    <span
      role="img"
      aria-label={presenceLabels[presence]}
      title={presenceLabels[presence]}
      className={`relative inline-block h-3 w-3 rounded-full ${dotStyles[presence]} ${className}`}
    />
  );
}

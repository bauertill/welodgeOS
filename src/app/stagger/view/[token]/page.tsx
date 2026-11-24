import { TRPCError } from "@trpc/server";
import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { LeaseClientView } from "~/app/_components/stagger/lease";
import { StaggerClientView } from "~/app/_components/stagger/planner";
import { leaseTitle } from "~/lib/stagger-lease-model";
import { pageTitle } from "~/lib/stagger-model";
import { api } from "~/trpc/server";

/** The reference's title ("Decron Apartments OBS"), which is also the saved PDF's name. */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const shared = await api.stagger.shared({ token }).catch(() => null);
  const title = !shared ? "We Lodge" : shared.kind === "lease" ? leaseTitle(shared.lease) : pageTitle(shared.clientLabel);
  return { title: { absolute: title }, robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

/**
 * The owner's read-only view (doc §4.12), by its share link: no sign-in, no OS
 * around it, no settings — only the name, the owner and the plan.
 */
export default async function StaggerSharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const shared = await api.stagger.shared({ token });
    return (
      <div className="-mx-6 -my-8">
        {shared.kind === "lease" ? (
          <LeaseClientView lease={shared.lease} reservations={shared.reservations} />
        ) : (
          <StaggerClientView data={shared.data} clientLabel={shared.clientLabel ?? "the owner"} />
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")) notFound();
    throw error;
  }
}

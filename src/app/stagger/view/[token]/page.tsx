import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { StaggerClientView } from "~/app/_components/stagger/planner";
import { api } from "~/trpc/server";

export const metadata = { title: "Phased arrivals — We Lodge", robots: { index: false, follow: false } };
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
        <StaggerClientView data={shared.data} clientLabel={shared.clientLabel ?? "the owner"} />
      </div>
    );
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")) notFound();
    throw error;
  }
}

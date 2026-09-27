import Link from "next/link";
import { redirect } from "next/navigation";

import { TeamDirectory } from "~/app/_components/team-directory";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Everyone at We Lodge and how to reach them."
        action={
          <Link
            href="/team/profile"
            className="border-ink-200 text-ink-700 hover:bg-ink-50 rounded-full border bg-white px-5 py-2.5 text-[13px] font-light"
          >
            Edit my profile
          </Link>
        }
      />
      <TeamDirectory myId={session.user.id} />
    </>
  );
}

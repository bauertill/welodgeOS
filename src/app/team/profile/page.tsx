import { redirect } from "next/navigation";

import { ProfileForm } from "~/app/_components/profile-form";
import { EmailPreferenceCard } from "~/app/_components/notification-bell";
import { BookingLinkCard } from "~/app/_components/sales-details";
import { ClaudeConnectionCard } from "~/app/_components/claude-connection";
import { GmailCard } from "~/app/_components/client-emails";
import { MyWork } from "~/app/_components/tasks";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "My profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  // Back from Google after Connect Gmail: how it went (doc §4.10).
  const { gmail } = await searchParams;

  return (
    <>
      <PageHeader
        title="My profile"
        subtitle="Your work, and your contact details as your colleagues see them."
        back={{ href: "/team", label: "Team" }}
      />
      <div className="border-ink-200/60 mb-8 rounded-xl border bg-white p-5">
        <MyWork />
      </div>
      <EmailPreferenceCard />
      <BookingLinkCard />
      <GmailCard outcome={gmail} />
      <ClaudeConnectionCard />
      <ProfileForm />
    </>
  );
}

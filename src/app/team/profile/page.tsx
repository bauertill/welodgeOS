import { redirect } from "next/navigation";

import { ProfileForm } from "~/app/_components/profile-form";
import { EmailPreferenceCard } from "~/app/_components/notification-bell";
import { MyWork } from "~/app/_components/tasks";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

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
      <ProfileForm />
    </>
  );
}

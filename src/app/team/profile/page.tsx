import { redirect } from "next/navigation";

import { ProfileForm } from "~/app/_components/profile-form";
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
        subtitle="Your contact details, as your colleagues see them."
        back={{ href: "/team", label: "Team" }}
      />
      <ProfileForm />
    </>
  );
}

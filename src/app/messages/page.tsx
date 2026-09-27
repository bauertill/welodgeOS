import { redirect } from "next/navigation";

import { Messages } from "~/app/_components/messages";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <>
      <PageHeader title="Messages" subtitle="Private conversations and groups with your colleagues." />
      <Messages myId={session.user.id} />
    </>
  );
}

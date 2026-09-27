import { redirect } from "next/navigation";

import { Messages } from "~/app/_components/messages";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Messages" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;

  return (
    <>
      <PageHeader title="Messages" subtitle="Private conversations and groups with your colleagues." />
      <Messages myId={session.user.id} selectedId={id} />
    </>
  );
}

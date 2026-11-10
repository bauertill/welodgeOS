import { redirect } from "next/navigation";

import { Guide } from "~/app/_components/guide";
import { auth } from "~/server/auth";

export const metadata = { title: "Sales guide" };

/** The sales team's guide (doc §2.11), at /guide/sales, for anyone signed in. */
export default async function SalesGuidePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return <Guide />;
}

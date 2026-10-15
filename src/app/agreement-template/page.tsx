import { redirect } from "next/navigation";

import { TemplateEditor } from "~/app/_components/agreement";
import { auth } from "~/server/auth";

/** An agreement's wording — for every client, or (?kind=hotel-us) every hotel at a US event (doc §4.11). */
export const metadata = { title: "Agreement wording" };

export default async function AgreementTemplatePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { kind } = await searchParams;
  return <TemplateEditor key={kind ?? "framework"} kind={kind === "hotel-us" ? "hotel-us" : "framework"} />;
}

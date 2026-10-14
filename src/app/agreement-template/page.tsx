import { redirect } from "next/navigation";

import { TemplateEditor } from "~/app/_components/agreement";
import { auth } from "~/server/auth";

/** The framework agreement's wording, for every client (doc §4.11). */
export const metadata = { title: "Framework agreement" };

export default async function AgreementTemplatePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return <TemplateEditor />;
}

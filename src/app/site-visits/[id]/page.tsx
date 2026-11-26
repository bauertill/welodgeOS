import { notFound, redirect } from "next/navigation";

import { SiteVisitActions, SiteVisitReportView } from "~/app/_components/site-visits";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Site visit report" };

/** A site visit report full size (doc §3.12): to read, print or save as a PDF. */
export default async function SiteVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const report = await api.siteVisit.byId({ id });
  if (!report) notFound();
  const first = report.units.find((unit) => unit.property)?.property;
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          back={first ? { href: `/properties/${first.id}`, label: first.name } : { href: "/events", label: "All events" }}
          title="Site visit report"
          subtitle={report.title}
          action={<SiteVisitActions report={report} />}
        />
      </div>
      <div className="max-w-4xl rounded-xl bg-white p-6 md:p-10 print:max-w-none print:p-0">
        <SiteVisitReportView report={report} />
      </div>
    </>
  );
}

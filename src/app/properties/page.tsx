import Link from "next/link";
import { redirect } from "next/navigation";

import { PropertiesTable } from "~/app/_components/properties-table";
import { EmptyState, PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const properties = await api.property.list();

  return (
    <>
      <PageHeader
        title="Properties"
        subtitle="Every hotel and apartment we have scouted. A property is recorded once and can appear on any number of events' lists."
        action={
          <Link
            href="/properties/new"
            className="bg-brand-400 hover:bg-brand-500 inline-flex rounded-full px-5 py-2.5 text-[13px] font-light text-white transition-colors"
          >
            Scout a property
          </Link>
        }
      />

      {properties.length === 0 ? (
        <EmptyState
          title="Nothing scouted yet"
          description="Add the hotels and apartments that could be contracted. Price, room counts and amenities now save a phone call later."
          action={
            <Link
              href="/properties/new"
              className="bg-brand-400 hover:bg-brand-500 inline-flex rounded-full px-6 py-2.5 text-[13px] font-light text-white"
            >
              Scout a property
            </Link>
          }
        />
      ) : (
        <PropertiesTable properties={properties} />
      )}
    </>
  );
}

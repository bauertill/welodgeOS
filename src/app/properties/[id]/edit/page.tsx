import { notFound, redirect } from "next/navigation";

import { PropertyForm } from "~/app/_components/property-form";
import { PageHeader } from "~/app/_components/ui";
import { contractingFields, propertyDetailFields, propertyServiceFields } from "~/lib/contracting";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Edit property" };

/** Numbers come back from the database; the form works in strings. */
const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export default async function EditPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  // Opened from an event's Properties tab: go back there, not to the property.
  // Only an event page is accepted, so the link cannot send anyone elsewhere.
  const { back } = await searchParams;
  const returnTo = back && /^\/events\/[A-Za-z0-9]+$/.test(back) ? back : undefined;
  const [property, amenities, existingNames] = await Promise.all([
    api.property.byId({ id }),
    api.amenity.list(),
    api.property.listNames(),
  ]);

  if (!property) notFound();

  return (
    <>
      <PageHeader
        back={
          returnTo
            ? { href: returnTo, label: "Back to the event's properties" }
            : { href: `/properties/${property.id}`, label: property.name }
        }
        title={`Edit ${property.name}`}
      />

      <PropertyForm
        returnTo={returnTo}
        amenities={amenities}
        existingNames={existingNames}
        initial={{
          id: property.id,
          name: property.name,
          type: property.type,
          address: property.address ?? "",
          city: property.city ?? "",
          country: property.country ?? "",
          latitude: str(property.latitude),
          longitude: str(property.longitude),
          stars: str(property.stars),
          totalRooms: str(property.totalRooms),
          website: property.website ?? "",
          phone: property.phone ?? "",
          notes: property.notes ?? "",
          amenityIds: property.amenities.map((amenity) => amenity.id),
          categories: property.categories.map((category) => ({
            id: category.id,
            name: category.name,
            unitCount: str(category.unitCount),
            capacity: str(category.capacity),
            bedConfiguration: category.bedConfiguration ?? "",
            bedrooms: str(category.bedrooms),
            bathrooms: str(category.bathrooms),
            priceMin:
              category.indicativePriceMinCents === null
                ? ""
                : String(category.indicativePriceMinCents / 100),
            priceMax:
              category.indicativePriceMaxCents === null
                ? ""
                : String(category.indicativePriceMaxCents / 100),
            currency: category.currency,
            size: category.size ?? "",
            notes: category.notes ?? "",
          })),
          contacts: property.contacts.map((contact) => ({
            name: contact.name,
            role: contact.role ?? "",
            email: contact.email ?? "",
            phone: contact.phone ?? "",
          })),
          details: Object.fromEntries(
            [...propertyDetailFields, ...propertyServiceFields, ...contractingFields].map((field) => [
              field.key,
              property[field.key] ?? "",
            ]),
          ),
          yearBuilt: str(property.yearBuilt),
          providerId: property.providerId ?? "",
        }}
      />
    </>
  );
}

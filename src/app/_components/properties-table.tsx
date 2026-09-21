"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import type { PropertyType } from "generated/prisma";

import { Pill, Table, Td, Th } from "~/app/_components/ui";
import { formatMoney, formatMoneyRange } from "~/lib/format";
import { cheapestCategory, propertyTypeLabels, totalUnits } from "~/lib/scouting";

type Category = {
  id: string;
  name: string;
  unitCount: number;
  bedConfiguration: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  indicativePriceMinCents: number | null;
  indicativePriceMaxCents: number | null;
  currency: string;
};

type PropertyRow = {
  id: string;
  name: string;
  type: PropertyType;
  stars: number | null;
  city: string | null;
  country: string | null;
  totalRooms: number | null;
  latitude: number | null;
  longitude: number | null;
  categories: Category[];
  amenities: { id: string; label: string }[];
  _count: { scoutingEntries: number };
};

/**
 * Status can differ by room type within the same property (doc §7), so the
 * list carries a one-click expand instead of forcing a visit to the property
 * page just to see whether it's one uniform block of rooms or several.
 */
export function PropertiesTable({ properties }: { properties: PropertyRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Table>
      <thead>
        <tr>
          <Th>Property</Th>
          <Th>Location</Th>
          <Th>Rooms</Th>
          <Th>From</Th>
          <Th>Amenities</Th>
          <Th>On lists</Th>
          <Th>Map</Th>
        </tr>
      </thead>
      <tbody>
        {properties.map((property) => {
          const cheapest = cheapestCategory(property.categories);
          const units =
            totalUnits(property.categories) || property.totalRooms || 0;
          const isOpen = expanded.has(property.id);
          const hasCategories = property.categories.length > 0;
          const hasBedConfiguration = property.type === "HOTEL";

          return (
            <Fragment key={property.id}>
              <tr>
                <Td>
                  <div className="flex items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggle(property.id)}
                      disabled={!hasCategories}
                      aria-expanded={isOpen}
                      aria-label={
                        isOpen ? "Collapse room categories" : "Expand room categories"
                      }
                      className="text-ink-400 hover:text-ink-700 mt-0.5 shrink-0 disabled:opacity-0"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      >
                        <path
                          d="M6 4l4 4-4 4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <div>
                      <Link
                        href={`/properties/${property.id}`}
                        className="hover:text-brand-700 font-medium"
                      >
                        {property.name}
                      </Link>
                      <span className="text-ink-500 block text-xs font-light">
                        {propertyTypeLabels[property.type]}
                        {property.stars ? ` · ${property.stars}-star` : ""}
                      </span>
                    </div>
                  </div>
                </Td>
                <Td>
                  {[property.city, property.country]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </Td>
                <Td>{units || "—"}</Td>
                <Td>
                  {cheapest
                    ? formatMoney(cheapest.indicativePriceMinCents!, cheapest.currency)
                    : "—"}
                </Td>
                <Td>
                  <div className="flex max-w-56 flex-wrap gap-1">
                    {property.amenities.slice(0, 3).map((amenity) => (
                      <Pill key={amenity.id}>{amenity.label}</Pill>
                    ))}
                    {property.amenities.length > 3 && (
                      <Pill>+{property.amenities.length - 3}</Pill>
                    )}
                    {property.amenities.length === 0 && "—"}
                  </div>
                </Td>
                <Td>{property._count.scoutingEntries}</Td>
                <Td>
                  {property.latitude !== null && property.longitude !== null
                    ? "Pinned"
                    : "—"}
                </Td>
              </tr>

              {isOpen && hasCategories && (
                <tr>
                  <Td colSpan={7}>
                    <div className="ml-5 space-y-1.5">
                      {property.categories.map((category) => (
                        <div
                          key={category.id}
                          className="text-ink-700 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-light"
                        >
                          <span className="text-ink-900 font-medium">
                            {category.name}
                          </span>
                          <span>
                            {category.unitCount}{" "}
                            {hasBedConfiguration ? "rooms" : "units"}
                          </span>
                          <span>
                            {hasBedConfiguration
                              ? (category.bedConfiguration ?? "—")
                              : `${category.bedrooms ?? "—"} bed · ${category.bathrooms ?? "—"} bath`}
                          </span>
                          <span>
                            {formatMoneyRange(
                              category.indicativePriceMinCents,
                              category.indicativePriceMaxCents,
                              category.currency,
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

"use client";

import Link, { useLinkStatus } from "next/link";

/** Swaps the link's words for "Opening…" while the next page loads. */
function Status({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <>{pending ? "Opening…" : children}</>;
}

/**
 * A link that shows it has been clicked. Without it, a page that takes a
 * moment to load looks as though the click did nothing.
 */
export function PendingLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className}>
      <Status>{children}</Status>
    </Link>
  );
}

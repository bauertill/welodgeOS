import Link from "next/link";
import type { ScoutingStatus } from "generated/prisma";

import { formatMoney } from "~/lib/format";
import { severityLabels, severityStyles, type Severity } from "~/lib/position";
import { scoutingStatusLabels } from "~/lib/scouting";

export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8">
      {back && (
        <Link
          href={back.href}
          className="text-ink-500 hover:text-brand-700 mb-2 inline-block text-[13px] font-light"
        >
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-ink-900 text-2xl font-semibold">{title}</h1>
          {subtitle && (
            <p className="text-ink-500 mt-1 text-sm font-light">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-ink-200/60 rounded-xl border bg-white p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
        {label}
      </p>
      <p className="text-ink-900 mt-2 text-3xl font-semibold">{value}</p>
      {hint && <p className="text-ink-500 mt-1 text-xs font-light">{hint}</p>}
    </Card>
  );
}

const scoutingStatusStyles: Record<ScoutingStatus, string> = {
  PROSPECT: "bg-ink-50 text-ink-500",
  CONTACTED: "bg-brand-50 text-brand-700",
  SHORTLISTED: "bg-brand-400 text-white",
  REJECTED: "bg-[#db4b68]/10 text-[#c03654]",
  CONTRACTED: "bg-[#12b878]/10 text-[#0d8f5d]",
};

export function ScoutingStatusBadge({ status }: { status: ScoutingStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap ${scoutingStatusStyles[status]}`}
    >
      {scoutingStatusLabels[status]}
    </span>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-ink-50 text-ink-500 inline-flex rounded-full px-2.5 py-1 text-[11px] font-light whitespace-nowrap">
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="py-14 text-center">
      <p className="text-ink-900 font-medium">{title}</p>
      <p className="text-ink-500 mx-auto mt-1 max-w-md text-sm font-light">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-ink-200/60 overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-ink-500 border-ink-200/60 border-b px-5 py-3 text-[11px] font-medium tracking-wider uppercase">
      {children}
    </th>
  );
}

export function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-ink-200/40 border-b px-5 py-3.5 align-top">
      {children}
    </td>
  );
}

// --- Phase 2 -----------------------------------------------------------------

/**
 * Severity is computed in one place (doc §4.4) and rendered the same way
 * everywhere: the stock sheet, the deadline dashboard and the exposure report
 * all agree about how bad a night is.
 */
export function SeverityBadge({
  severity,
  children,
}: {
  severity: Severity;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${severityStyles[severity]}`}
    >
      {children ?? severityLabels[severity]}
    </span>
  );
}

/**
 * A total, per currency. Buy and sell may differ in currency on the same night,
 * and nothing is ever converted — so a total that spans two currencies says so
 * rather than inventing a rate (invariant §4.5.9).
 */
export function MoneyTotal({
  amounts,
  empty = "—",
}: {
  amounts: { currency: string; cents: number }[];
  empty?: string;
}) {
  if (amounts.length === 0) return <span className="text-ink-500">{empty}</span>;
  return (
    <span className="whitespace-nowrap">
      {amounts.map((amount, index) => (
        <span key={amount.currency}>
          {index > 0 && <span className="text-ink-500"> · </span>}
          {formatMoney(amount.cents, amount.currency)}
        </span>
      ))}
    </span>
  );
}

/** A heading above a block of rows, used where a table is grouped. */
export function SectionHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h2 className="text-ink-900 text-lg font-semibold">{title}</h2>
        {hint && <p className="text-ink-500 mt-0.5 text-xs font-light">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

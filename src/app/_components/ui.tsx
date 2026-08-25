import type { BookingStatus } from "generated/prisma";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-ink-900 text-2xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-ink-500 mt-1 text-sm font-light">{subtitle}</p>
        )}
      </div>
      {action}
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
      className={`rounded-xl border border-ink-200/60 bg-white p-5 ${className}`}
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

const statusStyles: Record<BookingStatus, string> = {
  INQUIRY: "bg-ink-50 text-ink-500",
  OPTIONED: "bg-brand-50 text-brand-700",
  CONFIRMED: "bg-[#12b878]/10 text-[#0d8f5d]",
  CHECKED_IN: "bg-brand-400 text-white",
  CHECKED_OUT: "bg-ink-700 text-white",
  CANCELLED: "bg-[#db4b68]/10 text-[#c03654]",
};

export const statusLabels: Record<BookingStatus, string> = {
  INQUIRY: "Inquiry",
  OPTIONED: "Optioned",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="py-14 text-center">
      <p className="text-ink-900 font-medium">{title}</p>
      <p className="text-ink-500 mx-auto mt-1 max-w-md text-sm font-light">
        {description}
      </p>
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

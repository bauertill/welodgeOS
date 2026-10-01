"use client";

import Link from "next/link";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { api } from "~/trpc/react";

/**
 * Finances from anywhere (doc §7.1), opened from the menu like Events and
 * Sales: payments, cancellation deadlines and contracts, with what needs doing.
 */
export function FinancePanel({ onClose }: { onClose: () => void }) {
  const summary = api.finance.summary.useQuery();
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);
  const s = summary.data;
  const row = (href: string, title: string, detail: string, alert?: string | null) => (
    <li>
      <Link href={href} onClick={onClose} className="hover:bg-ink-50 block rounded-lg px-3 py-2.5 transition-colors">
        <span className="text-ink-900 block text-sm font-medium">{title}</span>
        <span className="text-ink-500 mt-0.5 block text-xs font-light">{detail}</span>
        {alert && <span className="mt-0.5 block text-xs font-medium text-[#c03654]">{alert}</span>}
      </Link>
    </li>
  );
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[1010] bg-black/20" onClick={onClose} aria-hidden="true" />
      <div className="border-ink-200/60 fixed inset-y-0 left-0 z-[1020] flex w-full max-w-sm flex-col border-r bg-white shadow-xl md:left-60">
        <div className="border-ink-200/60 flex items-start justify-between gap-3 border-b p-5">
          <div>
            <h2 className="text-ink-900 text-[15px] font-medium">Finances</h2>
            <p className="text-ink-500 mt-0.5 text-xs font-light">What we owe and are owed, and what can still be given back, from every contract.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-400 hover:text-ink-700">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <ul className="space-y-1">
            {row(
              "/finances/payments",
              "Payments",
              "To suppliers and from clients",
              s && s.supplierDue + s.clientDue > 0
                ? `${plural(s.supplierDue + s.clientDue, "payment", "payments")} due within a week or overdue`
                : null,
            )}
            {row(
              "/finances/cancellations",
              "Cancellations",
              "Deadlines with suppliers and with clients",
              s && s.cutoffs > 0 ? `${plural(s.cutoffs, "cut-off", "cut-offs")} within 30 days or passed` : null,
            )}
            {row(
              "/finances/contracts",
              "Contracts",
              "Every signed contract, with its terms",
              s && s.incomplete > 0 ? `${plural(s.incomplete, "contract is", "contracts are")} missing terms` : null,
            )}
          </ul>
        </div>
        <div className="border-ink-200/60 border-t p-5">
          <Link href="/finances/contracts/new" onClick={onClose} className="bg-brand-400 hover:bg-brand-500 rounded-full px-4 py-2 text-[13px] font-medium text-white">
            + New contract
          </Link>
        </div>
      </div>
    </>,
    document.body,
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { guideSections } from "~/lib/guide";
import { auth } from "~/server/auth";

export const metadata = { title: "Guides" };

/** One guide per team; more are added here as they are written (doc §2.11). */
const guides = [
  {
    href: "/guide/sales",
    title: "Sales guide",
    team: "Sales team",
    text: "From the first enquiry to the signed agreement — every step, with pictures, and answers for when you are stuck.",
    size: `${guideSections.length} sections`,
  },
];

/** The guides (doc §2.11): choose one. For anyone signed in. */
export default async function GuidesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="brand-gradient relative overflow-hidden rounded-2xl px-6 py-10 text-white shadow-sm md:px-10 md:py-12">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -right-4 -bottom-24 h-48 w-48 rounded-full bg-white/10" />
        <p className="text-[12px] font-medium tracking-[0.18em] text-white/70 uppercase">WeLodge OS</p>
        <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Guides</h1>
        <p className="mt-2 max-w-2xl text-[15px] font-light text-white/85">
          How the system is worked, step by step. Choose the guide for your part of the work.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {guides.map((guide) => (
          <Link
            key={guide.href}
            href={guide.href}
            className="group border-ink-200/60 hover:border-brand-400 flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition-colors"
          >
            <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">{guide.team}</p>
            <h2 className="text-ink-900 mt-1 text-lg font-semibold">{guide.title}</h2>
            <p className="text-ink-700 mt-2 flex-1 text-[13px] font-light">{guide.text}</p>
            <p className="mt-4 flex items-center justify-between text-[13px]">
              <span className="text-ink-500 font-light">{guide.size}</span>
              <span className="text-brand-700 group-hover:underline">Open →</span>
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

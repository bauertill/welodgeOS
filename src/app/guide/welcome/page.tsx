import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";

export const metadata = { title: "Welcome to We Lodge OS" };

/**
 * Welcome to We Lodge OS (doc §2.11; the owner, 2026-11-19: "the team can start
 * shifting over all of their work onto OS … from now on monday.com should be
 * view only, and all updates and reports need to be filled out on OS"). One
 * page for the whole team: what OS is, monday.com now read-only, the daily
 * habit, how people are told, where things live, and the house rules. The
 * owner sends its link; it is also first on the Guides page.
 */
export default async function WelcomeGuidePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-16">
      {/* Hero */}
      <div className="brand-gradient relative overflow-hidden rounded-2xl px-6 py-12 text-white shadow-sm md:px-12 md:py-16">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -right-4 -bottom-24 h-48 w-48 rounded-full bg-white/10" />
        <p className="text-[12px] font-medium tracking-[0.18em] text-white/70 uppercase">Welcome to We Lodge OS</p>
        <h1 className="mt-3 max-w-2xl text-3xl leading-tight font-semibold md:text-5xl">One place for all our work.</h1>
        <p className="mt-4 max-w-2xl text-[15px] font-light text-white/85 md:text-[17px]">
          We Lodge OS is where we now plan events, source and contract properties, sell to clients, and keep each other up to date.
        </p>
        <p className="mt-6 text-[13px] font-light text-white/70">A five-minute read.</p>
      </div>

      {/* From today */}
      <div className="flex flex-col gap-4 rounded-2xl border-2 border-[#e0234e]/30 bg-[#fdecef] p-6 md:flex-row md:items-center md:p-8">
        <Icon path="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" className="h-10 w-10 shrink-0 text-[#e0234e]" />
        <div>
          <p className="text-[12px] font-medium tracking-wider text-[#b3173b] uppercase">From today</p>
          <p className="text-ink-900 mt-1 text-xl font-semibold md:text-2xl">monday.com is now view only. All updates and reports go into OS.</p>
        </div>
      </div>

      {/* 1. What OS is */}
      <Section number={1} title="What We Lodge OS is" icon="M3 12l9-9 9 9M5 10v10h14V10">
        <p>
          We Lodge OS (&ldquo;OS&rdquo;) is our own system, built around how We Lodge actually works. Events, properties, room-nights, clients, sales requests,
          contracts, payments, tasks and updates all live in one place, linked to each other.
        </p>
        <p>
          Open a hotel and you see its contracts, quotations, tasks and full history. Open a client and you see every request, rate card and conversation.
        </p>
        <p>The sales team already works in OS. Now acquisitions and the rest of the team are moving over too, so from today OS is where the work happens.</p>
      </Section>

      {/* 2. monday.com */}
      <Section number={2} title="What changes with monday.com" icon="M4 6h16M4 12h16M4 18h10">
        <ul className="space-y-2.5">
          <Rule ok>Look things up on monday.com if you need old history.</Rule>
          <Rule>Add new items, updates, files or reports on monday.com.</Rule>
          <Rule ok>Log every update, call note, meeting summary and report in OS, on the property, client, request or contractor it is about.</Rule>
          <Rule ok>Create and assign all tasks in OS. Tasks no longer come through monday.com.</Rule>
        </ul>
        <p>If something is on monday.com but missing from OS, add it to OS, or tell Brandon, rather than updating monday.com.</p>
      </Section>

      {/* 3. Daily habit */}
      <Section number={3} title="Your daily habit" icon="M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z">
        <p className="text-ink-900 text-lg font-medium">Open OS every morning. Three minutes, three checks.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Step n={1} title="Check the bell">
            The bell at the top of every page shows what&apos;s new for you: tasks given to you, comments, replies, status changes, deadlines and client answers.
          </Step>
          <Step n={2} title="Open Tasks">
            Filter to your own tasks and start with anything overdue, shown in red. Move each one along as you work: To do, In progress, Done.
          </Step>
          <Step n={3} title="Skim Updates">
            See what the team posted since yesterday, and reply where you can help.
          </Step>
        </div>

        <h3 className="text-ink-900 pt-2 text-[15px] font-semibold">How you&apos;ll hear about things</h3>
        <div className="overflow-hidden rounded-xl border border-ink-200/60">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-ink-500 border-ink-200/60 border-b bg-white text-[10px] tracking-wider uppercase">
                <th className="px-4 py-2.5 font-medium">What happens</th>
                <th className="px-4 py-2.5 font-medium">Where you see it</th>
              </tr>
            </thead>
            <tbody className="divide-ink-200/40 divide-y bg-white">
              <tr>
                <td className="px-4 py-3">Someone @mentions (tags) you in a task, comment, update or reply</td>
                <td className="px-4 py-3">
                  <span className="text-ink-900 font-medium">An email straight away</span>, plus the bell
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3">A task is given to you, commented on, changes status, is due tomorrow or is overdue</td>
                <td className="px-4 py-3">The bell, and your 7:00 morning summary</td>
              </tr>
              <tr>
                <td className="px-4 py-3">A client answers a rate card</td>
                <td className="px-4 py-3">The bell, and your 7:00 morning summary</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong className="text-ink-900 font-medium">The morning summary:</strong> at 7:00 your local time, OS emails you whatever is still unread in your bell.
          Nothing is sent on a quiet day. You can change both emails on{" "}
          <Link href="/team/profile" className="text-brand-700 hover:underline">
            My profile
          </Link>
          .
        </p>
        <Note>Apart from tags, you only get the one morning email. That&apos;s why opening OS every day matters: new tasks don&apos;t arrive in your inbox one by one.</Note>
      </Section>

      {/* 4. Where things live */}
      <Section number={4} title="Where things live" icon="M9 20l-6-3V4l6 3m0 13 6-3m-6 3V7m6 10 6 3V7l-6-3m0 13V4">
        <p className="text-ink-900 text-lg font-medium">Everything has one home. Find it from the menu on the left.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {places.map((place) => (
            <Link key={place.title} href={place.href} className="group border-ink-200/60 hover:border-brand-400 rounded-xl border bg-white p-4 transition-colors">
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-ink-900 font-semibold">{place.title}</span>
                <span className="text-ink-500 text-[11px] font-light">{place.who}</span>
              </p>
              <p className="text-ink-700 mt-1 text-[13px] font-light">{place.text}</p>
            </Link>
          ))}
        </div>
        <div className="bg-brand-50/60 rounded-xl p-5">
          <p className="text-ink-900 font-semibold">For acquisitions</p>
          <p className="mt-1">
            Every property lives on its event. Open the event, then <strong className="font-medium">Properties</strong>, to work the list as a table or on the map.
            Each property page holds its quotations, contracts and payments, tasks and updates. Log calls, site visits and hotel feedback as updates on the property
            itself, so the whole team sees its story in one place.
          </p>
        </div>
      </Section>

      {/* 5. Updates and house rules */}
      <Section number={5} title="Updates, reports and the house rules" icon="M7 8h10M7 12h6m-9 8 3-3h11a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v15Z">
        <p className="text-ink-900 text-lg font-medium">If it isn&apos;t in OS, it didn&apos;t happen.</p>
        <p>
          <strong className="text-ink-900 font-medium">Post an update on the thing it is about.</strong> A hotel call goes on the property, client feedback on the
          client or its sales request, and a cleaning company&apos;s issue on the contractor. It shows in the team&apos;s Updates feed by itself. Use{" "}
          <strong className="font-medium">+ Meeting feedback</strong> or <strong className="font-medium">+ Call summary</strong> for meetings and calls.
        </p>
        <p>
          <strong className="text-ink-900 font-medium">Tag the people who need to know.</strong> Type @ and their name. They get an email straight away, with a link to
          the page.
        </p>
        <ol className="space-y-3">
          {houseRules.map(([title, text], i) => (
            <li key={title} className="flex gap-4 rounded-xl bg-white p-4">
              <span className="bg-brand-500 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white">{i + 1}</span>
              <span>
                <span className="text-ink-900 font-semibold">{title}</span> <span className="text-ink-700 font-light">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {/* Help + close */}
      <div className="brand-gradient rounded-2xl px-6 py-10 text-center text-white md:px-12">
        <p className="text-2xl font-semibold">Thanks for making the move. One place, one team.</p>
        <p className="mx-auto mt-3 max-w-xl text-[14px] font-light text-white/85">
          Stuck? Open the Guides and search them. If something still looks wrong or missing, tell Brandon.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/tasks" className="text-brand-700 rounded-lg bg-white px-5 py-2.5 text-[14px] font-medium shadow-sm hover:bg-white/90">
            Open my tasks
          </Link>
          <Link href="/guide" className="rounded-lg border border-white/50 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-white/10">
            All guides
          </Link>
        </div>
      </div>
    </div>
  );
}

const places = [
  { title: "Dashboard", href: "/", who: "Everyone", text: "Your starting point when you open OS." },
  {
    title: "Events",
    href: "/events",
    who: "Acquisitions, operations",
    text: "Each event with its Properties and map, Inventory, Deadlines, Position, Contractors and Event details.",
  },
  { title: "Sales", href: "/sales", who: "Sales", text: "Sales requests from first interest to signed, Clients and their contacts, and Rate cards." },
  { title: "Tasks", href: "/tasks", who: "Everyone", text: "The team's shared task board, as a Kanban or a list. Filter by person, event, status or priority." },
  { title: "Updates", href: "/updates", who: "Everyone", text: "Every update the team posts, in one feed, with replies and tags." },
  {
    title: "Contractors",
    href: "/contractors",
    who: "Operations, acquisitions",
    text: "Furniture, cleaning, linen and other companies we use besides hotels: contacts, contracts, payments and the properties they serve.",
  },
  { title: "Guides", href: "/guide", who: "Everyone", text: "Step-by-step guides, under your name at the bottom left. Searchable, with answers for when you're stuck." },
  { title: "My profile", href: "/team/profile", who: "Everyone", text: "Your details, and which emails you get." },
];

const houseRules: [string, string][] = [
  ["Open OS every working day", "and clear your bell."],
  ["Keep your tasks current.", "Move them as you work, and mark them Done when they're done."],
  ["Log every update and report in OS,", "never on monday.com, WhatsApp or email alone."],
  ["Ask for work with a task.", "Assign it, give it a deadline, and link it to the event, property or client."],
  ["Tag, don't chase.", "An @mention reaches people faster than a separate message."],
];

function Section({ number, title, icon, children }: { number: number; title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="bg-brand-50 text-brand-700 flex h-10 w-10 items-center justify-center rounded-xl">
          <Icon path={icon} className="h-5 w-5" />
        </span>
        <h2 className="text-ink-900 text-xl font-semibold md:text-2xl">
          <span className="text-ink-500 mr-2 font-light">{number}.</span>
          {title}
        </h2>
      </div>
      <div className="text-ink-700 space-y-4 text-[14px] leading-relaxed font-light md:text-[15px]">{children}</div>
    </section>
  );
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={path} />
    </svg>
  );
}

function Rule({ ok = false, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl bg-white p-3.5">
      <span className={`mt-0.5 shrink-0 text-[12px] font-semibold tracking-wider uppercase ${ok ? "text-[#0a7a47]" : "text-[#e0234e]"}`}>{ok ? "Do" : "Don't"}</span>
      <span>{children}</span>
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-5">
      <span className="bg-brand-500 flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-semibold text-white">{n}</span>
      <p className="text-ink-900 mt-3 font-semibold">{title}</p>
      <p className="text-ink-700 mt-1 text-[13px] font-light">{children}</p>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-brand-400 rounded-r-xl border-l-4 bg-white px-4 py-3 text-[13px]">
      <strong className="text-ink-900 font-medium">Good to know: </strong>
      {children}
    </p>
  );
}

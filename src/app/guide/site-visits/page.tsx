import Link from "next/link";
import { redirect } from "next/navigation";

import { CopyPrompt } from "~/app/_components/copy-prompt";
import { VerdictBadge } from "~/app/_components/site-visits";
import { auth } from "~/server/auth";

export const metadata = { title: "Site visit reports with Claude" };

/**
 * How to post a site visit report with Claude (doc §2.11, §3.12; the owner,
 * 2026-11-26: "a guide on how to use Claude to write the site inspection
 * feedback … nicely designed under the guide section"). For whoever visits
 * properties: what to capture, the prompt to copy, checking and confirming,
 * the verdicts, and changing a report later.
 */
export default async function SiteVisitGuidePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-16">
      {/* Hero */}
      <div className="brand-gradient relative overflow-hidden rounded-2xl px-6 py-12 text-white shadow-sm md:px-12 md:py-16">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -right-4 -bottom-24 h-48 w-48 rounded-full bg-white/10" />
        <p className="text-[12px] font-medium tracking-[0.18em] text-white/70 uppercase">Guide · Site visits</p>
        <h1 className="mt-3 max-w-2xl text-3xl leading-tight font-semibold md:text-5xl">Your notes in, a finished report out.</h1>
        <p className="mt-4 max-w-2xl text-[15px] font-light text-white/85 md:text-[17px]">
          After a site visit, give Claude your notes and videos. Claude writes the report and posts it on the property in OS, so you don&apos;t type it in yourself.
        </p>
        <p className="mt-6 text-[13px] font-light text-white/70">A three-minute read. Keep it open on your first report.</p>
      </div>

      {/* Where it shows */}
      <Section number={1} title="Where the report ends up" icon="M3 12l9-9 9 9M5 10v10h14V10">
        <div className="grid gap-3 md:grid-cols-3">
          <Card title="On each property">The property&apos;s Site visits tab holds the full report, laid out like Alex&apos;s, with Print / PDF.</Card>
          <Card title="On the provider">The landlord or chain&apos;s page lists every visit to their properties, for example Babak.</Card>
          <Card title="On the properties board">
            Each property&apos;s card carries its verdict badge, so the board shows at a glance which places are worth pursuing.
            <span className="mt-2 flex flex-wrap gap-1.5">
              <VerdictBadge verdict="STRONG" />
              <VerdictBadge verdict="NEEDS_WORK" />
            </span>
          </Card>
        </div>
        <Note>
          See a real one: Alex and Eric&apos;s Babak visit of 23 November, on the three Babak apartments on the LA28 properties board.
        </Note>
      </Section>

      {/* Before you start */}
      <Section number={2} title="Before you start" icon="M13 10V3L4 14h7v7l9-11h-7Z">
        <div className="grid gap-3 md:grid-cols-3">
          <Step n={1} title="Connect OS to Claude">
            Do this once. In Claude, open Settings › Connectors and check that <strong className="font-medium">We Lodge OS</strong> is connected and signed in with
            your We Lodge account. Can&apos;t see it? Ask Brandon.
          </Step>
          <Step n={2} title="Start a new chat">
            Use a new chat for each report. A new chat always has the newest OS tools; an old one may not know it can post site visits.
          </Step>
          <Step n={3} title="Have your material ready">
            Your notes (typed, voice-to-text or a PDF), the Dropbox links to your videos, the date, and who went.
          </Step>
        </div>
      </Section>

      {/* During the visit */}
      <Section number={3} title="During the visit: what to capture" icon="M15 10l4.6-2.3A1 1 0 0 1 21 8.6v6.8a1 1 0 0 1-1.4.9L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z">
        <p className="text-ink-900 text-lg font-medium">Claude only knows what you give it. For each unit or property, capture:</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          <Capture title="One video per room or area">Name each one clearly (&ldquo;209 – Kitchen&rdquo;), upload it to Dropbox and copy its share link.</Capture>
          <Capture title="The facts">Building, how many it sleeps, bedrooms and beds, bathrooms, floor, kitchen, laundry, outdoor space, entry, and its condition.</Capture>
          <Capture title="Issues and needs">
            What&apos;s wrong or missing, and when it shows in the video: &ldquo;stained carpet, bedroom 2 video at 0:45&rdquo;.
          </Capture>
          <Capture title="Your verdict, in your words">Would you put guests here as it is, after fixes, or not at all?</Capture>
          <Capture title="What you couldn't see">&ldquo;Occupied, couldn&apos;t film.&rdquo; Claude writes Not seen and never guesses.</Capture>
          <Capture title="Who went, and who showed you round">For example: Alex and Eric, shown round by Minerva.</Capture>
        </ul>
      </Section>

      {/* Step by step */}
      <Section number={4} title="Step by step" icon="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01">
        <ol className="space-y-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="flex gap-4 rounded-xl bg-white p-4">
              <span className="bg-brand-500 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white">{i + 1}</span>
              <span>
                <span className="text-ink-900 font-semibold">{title}</span> <span className="text-ink-700 font-light">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <Note>Claude never posts without your yes. The report is recorded in OS under your name, &ldquo;via Claude&rdquo;.</Note>
      </Section>

      {/* Prompt */}
      <Section number={5} title="The prompt to copy" icon="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z">
        <p>Copy it into a new Claude chat, replace the parts in [brackets], and paste your notes and video links at the bottom.</p>
        <CopyPrompt text={prompt} />
      </Section>

      {/* Verdicts */}
      <Section number={6} title="The verdicts, and what a report holds" icon="M9 12l2 2 4-4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z">
        <p>
          Each place gets one of four verdicts. You can put a short note in your own words in its place on the badge, such as{" "}
          <VerdictBadge verdict="STRONG" note="Stronger option out of the 3" />.
        </p>
        <div className="border-ink-200/60 overflow-hidden rounded-xl border">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-ink-500 border-ink-200/60 border-b bg-white text-[10px] tracking-wider uppercase">
                <th className="px-4 py-2.5 font-medium">Verdict</th>
                <th className="px-4 py-2.5 font-medium">Use it when</th>
              </tr>
            </thead>
            <tbody className="divide-ink-200/40 divide-y bg-white">
              {verdicts.map(([verdict, text]) => (
                <tr key={verdict}>
                  <td className="px-4 py-3">
                    <VerdictBadge verdict={verdict} />
                  </td>
                  <td className="px-4 py-3">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {parts.map(([title, text]) => (
            <Card key={title} title={title}>
              {text}
            </Card>
          ))}
        </div>
      </Section>

      {/* Changing it */}
      <Section number={7} title="Changing a report, and tips" icon="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z">
        <ul className="space-y-2.5">
          <Rule ok>
            <strong className="text-ink-900 font-medium">Correct it by asking Claude:</strong> &ldquo;Open the Babak site visit report on OS and change…&rdquo;. It saves
            the change in place. You can also press <strong className="font-medium">Edit</strong> on the report in OS.
          </Rule>
          <Rule ok>
            <strong className="text-ink-900 font-medium">One visit, one report.</strong> Saw several places on the same visit? Keep them in one report so they&apos;re
            compared side by side.
          </Rule>
          <Rule ok>
            <strong className="text-ink-900 font-medium">Use the same facts for every place</strong> (Sleeps, Bathrooms, Kitchen…) so the at-a-glance table lines up.
          </Rule>
          <Rule>
            <strong className="text-ink-900 font-medium">Let Claude fill gaps.</strong> If it writes something you didn&apos;t see or say, tell it to take it out before
            you confirm.
          </Rule>
        </ul>
        <p>
          Claude can&apos;t delete anything. To remove a report, use <strong className="text-ink-900 font-medium">Delete</strong> on the report in OS.
        </p>
      </Section>

      {/* Close */}
      <div className="brand-gradient rounded-2xl px-6 py-10 text-center text-white md:px-12">
        <p className="text-2xl font-semibold">Visit, film, paste, confirm. That&apos;s the report.</p>
        <p className="mx-auto mt-3 max-w-xl text-[14px] font-light text-white/85">Stuck, or Claude can&apos;t see OS? Message Brandon on chat, with a screenshot.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className="text-brand-700 rounded-lg bg-white px-5 py-2.5 text-[14px] font-medium shadow-sm hover:bg-white/90">
            Open Claude
          </a>
          <Link href="/guide" className="rounded-lg border border-white/50 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-white/10">
            All guides
          </Link>
        </div>
      </div>
    </div>
  );
}

const prompt = `Please write a site visit report and post it on WeLodge OS.

Event: [LA28]
Date of visit: [23 November 2026]
Who went: [Alex and Eric], shown round by [Minerva]
Provider / landlord: [Babak]
Places visited: [Unit 209, 1540 6th St; Unit 505, Living at Santa Monica; 626 Broadway]

For each place: a verdict, a one-line conclusion, the facts at a glance, room by room, issues with the video and time they show in, and the video links.
Keep my words and facts. Write "Not seen" for anything I didn't see. Don't invent anything.
If a property isn't in OS yet, add it to the event as a Prospect, under the provider.
Show me the full report before you post it.

My notes and video links:
[paste here]`;

const steps: [string, string][] = [
  ["Open a new Claude chat", "and paste in or attach your notes, your PDF and the video links."],
  ["Tell Claude what to do:", "which event, the date, who went and which provider or landlord, then ask it to post the report on OS. The prompt below does all of this."],
  [
    "Claude looks things up first.",
    "It searches OS for each property and the provider. If a property isn't there yet, it offers to add it to the event's board as a Prospect. Each apartment or unit is its own property.",
  ],
  [
    "Claude shows you the report before posting.",
    "Check the verdicts, the facts and that no video link is missing. Correct anything in plain words: “505 has a dryer, not just a washer”.",
  ],
  ["Say “yes, post it”.", "Claude posts the report and gives you the link."],
  ["Open the link and check it in OS.", "Use Print / PDF on the report if you need to send it to someone."],
];

const verdicts: ["STRONG" | "NEEDS_WORK" | "NOT_READY" | "NO_GO", string][] = [
  ["STRONG", "Ready for guests as it is, or with small touches."],
  ["NEEDS_WORK", "Usable once specific fixes are made or items are added."],
  ["NOT_READY", "Couldn't be judged, or far from ready: still occupied, under works."],
  ["NO_GO", "We won't use it."],
];

const parts: [string, string][] = [
  ["Summary", "The visit in a few lines: who went, where, and what was seen."],
  ["At a glance", "The facts for every place visited, side by side, to compare."],
  ["Room by room", "Each area and what was seen there."],
  ["Issues and needs", "A short title, the detail, and the video and time it shows in."],
  ["Videos", "Every video, named and linked."],
  ["Conclusion", "One or two lines per place, under its verdict."],
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-5">
      <p className="text-ink-900 font-semibold">{title}</p>
      <p className="text-ink-700 mt-1 text-[13px] font-light">{children}</p>
    </div>
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

function Capture({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl bg-white p-4">
      <Icon path="M20 6 9 17l-5-5" className="text-brand-600 mt-0.5 h-5 w-5 shrink-0" />
      <span>
        <span className="text-ink-900 block font-semibold">{title}</span>
        <span className="text-[13px]">{children}</span>
      </span>
    </li>
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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-brand-400 rounded-r-xl border-l-4 bg-white px-4 py-3 text-[13px]">
      <strong className="text-ink-900 font-medium">Good to know: </strong>
      {children}
    </p>
  );
}

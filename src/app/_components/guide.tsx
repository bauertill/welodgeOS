"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { firstDay, guideSections, journey, stuck, type GuideSection, type GuideShot } from "~/lib/guide";

/**
 * The sales team's guide (doc §2.11): searchable, so someone stuck finds the
 * answer without asking. The words are in src/lib/guide.ts.
 */

const words = (query: string) => query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);

/** `**bold**` and `*italic*`, with any searched-for word marked. */
function Rich({ text, terms = [] }: { text: string; terms?: string[] }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  const mark = (value: string, key: string) => {
    if (!terms.length) return value;
    const pattern = new RegExp(`\\b(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return value.split(pattern).map((piece, index) =>
      index % 2 ? (
        <mark key={`${key}-${index}`} className="bg-brand-100 text-ink-900 rounded px-0.5">
          {piece}
        </mark>
      ) : (
        piece
      ),
    );
  };
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") ? (
          <strong key={index} className="text-ink-900 font-semibold">
            {mark(part.slice(2, -2), String(index))}
          </strong>
        ) : part.startsWith("*") ? (
          <em key={index}>{mark(part.slice(1, -1), String(index))}</em>
        ) : (
          <span key={index}>{mark(part, String(index))}</span>
        ),
      )}
    </>
  );
}

const sectionText = (section: GuideSection) =>
  [section.title, section.lead, ...(section.steps ?? []), ...(section.points ?? []), ...(section.tips ?? []), ...(section.table?.rows.flat() ?? []), section.keywords ?? "", ...(section.shots ?? []).map((shot) => shot.caption)]
    .join(" ")
    .toLowerCase();

const matches = (text: string, terms: string[]) => terms.every((term) => text.toLowerCase().includes(term));

export function Guide() {
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState<GuideShot | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const terms = useMemo(() => words(query), [query]);

  // "/" jumps to the search, as on most help pages.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    if (!terms.length) return null;
    const questions = stuck.filter((item) => matches(`${item.question} ${item.answer}`, terms));
    const sections = guideSections
      .filter((section) => matches(sectionText(section), terms))
      .map((section) => ({
        section,
        lines: [...(section.steps ?? []), ...(section.points ?? []), ...(section.tips ?? [])].filter((line) => terms.some((term) => line.toLowerCase().includes(term))).slice(0, 3),
      }));
    return { questions, sections };
  }, [terms]);

  const go = (id: string) => {
    setQuery("");
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <div className="mx-auto max-w-6xl">
      {/* The banner, with the search where the eye lands. */}
      <div className="brand-gradient relative overflow-hidden rounded-2xl px-6 py-10 text-white shadow-sm md:px-10 md:py-12">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -right-4 -bottom-24 h-48 w-48 rounded-full bg-white/10" />
        <Link href="/guide" className="relative text-[13px] font-light text-white/80 hover:text-white hover:underline">
          ← All guides
        </Link>
        <p className="mt-4 text-[12px] font-medium tracking-[0.18em] text-white/70 uppercase">WeLodge OS · Sales team</p>
        <h1 className="mt-2 text-3xl font-semibold md:text-4xl">The sales guide</h1>
        <p className="mt-2 max-w-2xl text-[15px] font-light text-white/85">
          From the first enquiry to the signed agreement — every step, with pictures. Stuck? Search for what you are trying to do.
        </p>
        <div className="relative mt-6 max-w-2xl">
          <svg aria-hidden viewBox="0 0 20 20" className="text-ink-500 pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 4 4" strokeLinecap="round" />
          </svg>
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the guide — e.g. offer ran out, addendum, Gmail"
            aria-label="Search the guide"
            className="text-ink-900 placeholder:text-ink-500/70 focus:ring-brand-200 w-full rounded-full border-0 bg-white py-3.5 pr-14 pl-12 text-[15px] shadow-lg outline-none focus:ring-4"
          />
          <kbd className="border-ink-200 text-ink-500 absolute top-1/2 right-4 hidden -translate-y-1/2 rounded border px-1.5 text-[11px] md:block">/</kbd>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
          {[
            ["I'm stuck", "stuck"],
            ["Your first day", "first-day"],
            ["The journey", "journey"],
            ["Words we use", "words"],
          ].map(([label, id]) => (
            <button key={id} type="button" onClick={() => go(id!)} className="rounded-full bg-white/15 px-3.5 py-1.5 backdrop-blur transition-colors hover:bg-white/25">
              {label}
            </button>
          ))}
        </div>
      </div>

      {results ? (
        <SearchResults results={results} terms={terms} onGo={go} query={query} />
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Contents onGo={go} />
          <div className="min-w-0 space-y-8">
            <div className="grid gap-6 md:grid-cols-2">
              <FirstDay />
              <Journey onGo={go} />
            </div>
            {guideSections.map((section) => (
              <Section key={section.id} section={section} onZoom={setZoom} />
            ))}
            <Stuck onGo={go} />
            <p className="text-ink-500 pb-8 text-center text-[13px] font-light">
              Something missing or wrong in this guide? Tell Brandon — the guide is updated with the system.
            </p>
          </div>
        </div>
      )}

      {zoom && (
        <div role="dialog" aria-label={zoom.caption} onClick={() => setZoom(null)} className="bg-ink-900/80 fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 p-6 backdrop-blur-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot shown at its own size */}
          <img src={zoom.src} alt={zoom.caption} className="max-h-[85vh] max-w-full rounded-xl shadow-2xl" />
          <p className="text-sm text-white/90">{zoom.caption}</p>
        </div>
      )}
    </div>
  );
}

function Contents({ onGo }: { onGo: (id: string) => void }) {
  return (
    <nav aria-label="Contents" className="hidden lg:block">
      <div className="sticky top-6 space-y-0.5">
        <p className="text-ink-500 mb-2 px-3 text-[11px] font-medium tracking-wider uppercase">Contents</p>
        {guideSections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(event) => {
              event.preventDefault();
              onGo(section.id);
            }}
            className="text-ink-700 hover:bg-brand-50 hover:text-brand-800 flex gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors"
          >
            <span className="text-brand-600 w-4 shrink-0 text-right font-medium">{section.number}</span>
            {section.title}
          </a>
        ))}
        <a
          href="#stuck"
          onClick={(event) => {
            event.preventDefault();
            onGo("stuck");
          }}
          className="bg-brand-50 text-brand-800 hover:bg-brand-100 mt-3 flex rounded-lg px-3 py-2 text-[13px] font-medium"
        >
          I'm stuck →
        </a>
      </div>
    </nav>
  );
}

/** Ticked in this browser only: a convenience, not a record. */
function FirstDay() {
  const key = "welodge-guide-first-day";
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
    } catch {}
  }, []);
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((one) => one !== id) : [...done, id];
    setDone(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return (
    <div id="first-day" className="border-ink-200/60 scroll-mt-6 rounded-2xl border bg-white p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-ink-900 text-lg font-semibold">Your first day</h2>
        <span className="text-brand-700 text-[13px] font-medium">
          {done.length} of {firstDay.length}
        </span>
      </div>
      <div className="bg-ink-50 mt-3 h-1.5 overflow-hidden rounded-full">
        <div className="brand-gradient h-full rounded-full transition-all" style={{ width: `${(done.length / firstDay.length) * 100}%` }} />
      </div>
      <ul className="mt-4 space-y-2.5">
        {firstDay.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-start gap-3 text-[14px]">
              <input type="checkbox" checked={done.includes(item.id)} onChange={() => toggle(item.id)} className="accent-brand-600 mt-0.5 h-4 w-4 shrink-0" />
              <span className={done.includes(item.id) ? "text-ink-500 line-through" : "text-ink-700"}>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Journey({ onGo }: { onGo: (id: string) => void }) {
  return (
    <div id="journey" className="border-ink-200/60 scroll-mt-6 rounded-2xl border bg-white p-6">
      <h2 className="text-ink-900 text-lg font-semibold">The journey of a request</h2>
      <p className="text-ink-500 mt-1 text-[13px] font-light">Any open request can be closed as Lost/Declined, and reopened.</p>
      <ol className="mt-4 space-y-1.5">
        {journey.map((step, index) => (
          <li key={step.stage}>
            <button type="button" onClick={() => onGo(step.section)} className="hover:bg-brand-50 group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                  index === journey.length - 1 ? "bg-success text-white" : "bg-brand-100 text-brand-800"
                }`}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="text-ink-900 block text-[14px] font-medium">{step.stage}</span>
                <span className="text-ink-500 block text-[12.5px] font-light">{step.you}</span>
              </span>
              <span className="text-brand-600 ml-auto opacity-0 transition-opacity group-hover:opacity-100">→</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Section({ section, onZoom }: { section: GuideSection; onZoom: (shot: GuideShot) => void }) {
  return (
    <section id={section.id} className="border-ink-200/60 scroll-mt-6 rounded-2xl border bg-white p-6 md:p-8">
      <div className="flex items-start gap-4">
        <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold text-white shadow-sm">{section.number}</span>
        <div className="min-w-0">
          <h2 className="text-ink-900 text-xl font-semibold">{section.title}</h2>
          <p className="text-ink-700 mt-1 text-[15px] leading-relaxed">{section.lead}</p>
        </div>
      </div>

      <div className="mt-6 space-y-6 md:pl-14">
        {section.steps && (
          <ol className="space-y-3">
            {section.steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-[14.5px] leading-relaxed">
                <span className="border-brand-300 text-brand-700 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold">{index + 1}</span>
                <span className="text-ink-700">
                  <Rich text={step} />
                </span>
              </li>
            ))}
          </ol>
        )}

        {section.points && (
          <ul className="space-y-2.5">
            {section.points.map((point, index) => (
              <li key={index} className="flex gap-3 text-[14.5px] leading-relaxed">
                <span className="bg-brand-400 mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                <span className="text-ink-700">
                  <Rich text={point} />
                </span>
              </li>
            ))}
          </ul>
        )}

        {section.table && (
          <div className="border-ink-200/70 overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-brand-50 text-brand-900">
                <tr>
                  {section.table.head.map((cell) => (
                    <th key={cell} className="px-4 py-2.5 text-[12px] font-semibold tracking-wide uppercase">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-ink-200/60 divide-y">
                {section.table.rows.map(([first, second]) => (
                  <tr key={first}>
                    <td className="text-ink-900 w-1/3 px-4 py-2.5 align-top font-medium">{first}</td>
                    <td className="text-ink-700 px-4 py-2.5 align-top">{second}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {section.tips?.map((tip, index) => (
          <div key={index} className="border-brand-400 bg-brand-50 rounded-r-xl border-l-4 px-4 py-3 text-[14px] leading-relaxed">
            <p className="text-brand-700 mb-0.5 text-[11px] font-semibold tracking-wider uppercase">Good to know</p>
            <p className="text-ink-700">
              <Rich text={tip} />
            </p>
          </div>
        ))}

        {section.shots && (
          <div className="space-y-6">
            {section.shots.map((shot) => (
              <figure key={shot.src} className="group">
                <button type="button" onClick={() => onZoom(shot)} className="border-ink-200 block w-full cursor-zoom-in overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md" aria-label={`Enlarge: ${shot.caption}`}>
                  <div className="bg-ink-700 flex items-center gap-1.5 px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                    <span className="ml-3 text-[11px] text-white/50">os.welodge.net</span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot */}
                  <img src={shot.src} alt={shot.caption} loading="lazy" className="block w-full" />
                </button>
                <figcaption className="text-ink-500 mt-2 text-[13px] font-light">{shot.caption}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Stuck({ onGo }: { onGo: (id: string) => void }) {
  return (
    <section id="stuck" className="border-brand-200 bg-brand-50/60 scroll-mt-6 rounded-2xl border p-6 md:p-8">
      <h2 className="text-ink-900 text-xl font-semibold">I'm stuck</h2>
      <p className="text-ink-700 mt-1 text-[15px]">The questions people ask most. Not here? Search above, then ask in the team chat.</p>
      <div className="mt-5 space-y-2">
        {stuck.map((item) => (
          <details key={item.id} id={`stuck-${item.id}`} className="group border-ink-200/60 rounded-xl border bg-white">
            <summary className="text-ink-900 flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[14.5px] font-medium">
              {item.question}
              <span className="text-brand-600 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="text-ink-700 px-4 pb-4 text-[14px] leading-relaxed">
              <Rich text={item.answer} />{" "}
              <button type="button" onClick={() => onGo(item.section)} className="text-brand-700 font-medium hover:underline">
                More in “{guideSections.find((section) => section.id === item.section)?.title}” →
              </button>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function SearchResults({
  results,
  terms,
  onGo,
  query,
}: {
  results: { questions: typeof stuck; sections: { section: GuideSection; lines: string[] }[] };
  terms: string[];
  onGo: (id: string) => void;
  query: string;
}) {
  const count = results.questions.length + results.sections.length;
  return (
    <div className="mt-8 space-y-6">
      <p className="text-ink-500 text-sm">
        {count ? `${count} ${count === 1 ? "result" : "results"} for “${query.trim()}”` : `Nothing found for “${query.trim()}”. Try fewer or other words — or ask in the team chat.`}
      </p>
      {results.questions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-ink-500 text-[12px] font-medium tracking-wider uppercase">Answers</h2>
          {results.questions.map((item) => (
            <div key={item.id} className="border-brand-200 rounded-xl border bg-white p-4">
              <p className="text-ink-900 font-medium">
                <Rich text={item.question} terms={terms} />
              </p>
              <p className="text-ink-700 mt-1 text-[14px] leading-relaxed">
                <Rich text={item.answer} terms={terms} />
              </p>
              <button type="button" onClick={() => onGo(item.section)} className="text-brand-700 mt-2 text-[13px] font-medium hover:underline">
                Open the section →
              </button>
            </div>
          ))}
        </div>
      )}
      {results.sections.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-ink-500 text-[12px] font-medium tracking-wider uppercase">In the guide</h2>
          {results.sections.map(({ section, lines }) => (
            <button key={section.id} type="button" onClick={() => onGo(section.id)} className="border-ink-200/60 hover:border-brand-300 block w-full rounded-xl border bg-white p-4 text-left transition-colors">
              <p className="text-ink-900 font-medium">
                <span className="text-brand-600 mr-2">{section.number}</span>
                <Rich text={section.title} terms={terms} />
              </p>
              <p className="text-ink-500 mt-0.5 text-[13.5px]">
                <Rich text={section.lead} terms={terms} />
              </p>
              {lines.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {lines.map((line, index) => (
                    <li key={index} className="text-ink-700 border-brand-200 border-l-2 pl-3 text-[13.5px]">
                      <Rich text={line} terms={terms} />
                    </li>
                  ))}
                </ul>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

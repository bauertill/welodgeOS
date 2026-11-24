"use client";

import "~/styles/stagger-lease.css";

import { Lato } from "next/font/google";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, friendlyError } from "~/app/_components/form";
import { ShareDialog } from "~/app/_components/stagger/editor";
import { formatDate } from "~/lib/format";
import {
  computeLease,
  DAY,
  DOW,
  fd,
  leaseCopy,
  leaseDefaults,
  leaseTitle,
  leaseWarnings,
  MON,
  MONL,
  money,
  okDate,
  one,
  parseReservationCsv,
  setCount,
  setUnits,
  type LeaseComputed,
  type LeaseSettings,
  type MinBack,
  type Reservation,
} from "~/lib/stagger-lease-model";
import { SEED_RESERVATIONS } from "~/lib/stagger-lease-seed";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * A staggered-lease scenario of the Stagger Planner (doc §4.12), as its
 * reference page: the page the provider reads, and — in the editor — the
 * *Edit numbers* drawer. The numbers all come from stagger-lease-model.
 * Only the provider's rent is shown; never our prices, margins or costs.
 */

// Lato, as the reference page; served from our own domain by Next.
const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato" });

const seedList = (): Reservation[] => SEED_RESERVATIONS.map(([checkIn, checkOut]) => ({ checkIn, checkOut }));
const isSeed = (list: Reservation[]) =>
  list.length === SEED_RESERVATIONS.length && list.every((r, i) => r.checkIn === SEED_RESERVATIONS[i]![0] && r.checkOut === SEED_RESERVATIONS[i]![1]);

/** Redrawn when its box changes width, and at the page's width before printing. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth || 900);
    measure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    });
    observer.observe(node);
    window.addEventListener("beforeprint", measure);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      window.removeEventListener("beforeprint", measure);
    };
  }, [ref]);
  return width;
}

/** Rental periods: one bar per group of apartments with the same move-in and hand-back, over the Games periods. Plain SVG. */
function Gantt({ c }: { c: LeaseComputed }) {
  const host = useRef<HTMLDivElement>(null);
  const measured = useWidth(host);
  if (!c.groups.length) return <div ref={host} />;
  const { groups, T } = c;
  const W = Math.max(660, measured);
  const ml = 74;
  const mr = 40;
  const top = 30;
  const s0 = new Date(c.minStart);
  const x0 = Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth(), 1);
  const e0 = new Date(c.maxEnd);
  const x1 = Date.UTC(e0.getUTCFullYear(), e0.getUTCMonth() + 1, 1);
  const x = (t: number) => ml + ((t - x0) / (x1 - x0)) * (W - ml - mr);
  const maxN = Math.max(...groups.map((g) => g.n));
  const th = (n: number) => 16 + (n / maxN) * 12;
  const ys: number[] = [];
  let yy = top;
  groups.forEach((g, i) => {
    if (i && g.s !== groups[i - 1]!.s) yy += 10;
    ys.push(yy + th(g.n) / 2);
    yy += th(g.n) + 5;
  });
  const H = yy + 28;
  const ticks: number[] = [];
  for (let t = x0; t <= x1; ) {
    ticks.push(t);
    const d = new Date(t);
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const periods = (
    [
      [T.open, T.c1 + DAY, "Games period 1"],
      [T.o2, T.c2 + DAY, "Games period 2"],
    ] as const
  ).filter(([a, b]) => !(b < x0 || a > x1));
  return (
    <div ref={host}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Rental periods for ${c.N} apartments in ${groups.length} groups`}>
        {periods.map(([a, b, label]) => (
          <g key={label}>
            <rect x={x(a)} y={top - 8} width={Math.max(1, x(b) - x(a))} height={H - top - 20} fill="var(--games)" />
            <text x={(x(a) + x(b)) / 2} y={top - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--games-ink)">
              {label}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 8} y2={H - 20} stroke="var(--grid)" />
            {t < x1 && (
              <text x={x(t) + 5} y={H - 6} fontSize={12} fill="var(--muted)">
                {MON[new Date(t).getUTCMonth()]}
              </text>
            )}
          </g>
        ))}
        {groups.map((g, i) => {
          const h = th(g.n);
          const y = ys[i]!;
          const per = `${fd(g.s)} – ${fd(g.e)}`;
          const bw = x(g.e) - x(g.s);
          const inside = bw > per.length * 6 + 16;
          return (
            <g key={`${g.s}|${g.e}`}>
              {(!i || g.s !== groups[i - 1]!.s) && (
                <text x={ml - 10} y={y + 4} textAnchor="end" fontSize={12} fontWeight={700} fill="var(--ink)">
                  {fd(g.s)}
                </text>
              )}
              <rect x={x(g.s)} y={y - h / 2} width={Math.max(2, bw)} height={h} rx={Math.min(3, h / 2)} fill="var(--bar)">
                <title>{`${g.n}${g.n === 1 ? " apartment" : " apartments"}, ${fd(g.s)} to ${fd(g.e)}`}</title>
              </rect>
              {inside && (
                <text x={x(g.s) + 8} y={y + 4} fontSize={11} fontWeight={700} fill="#ffffff">
                  {per}
                </text>
              )}
              <text x={x(g.e) + 6} y={y + 4} fontSize={12} fontWeight={700} fill="var(--ink)" style={{ whiteSpace: "pre" }}>
                {String(g.n) + (inside ? "" : `  ${per}`)}
              </text>
            </g>
          );
        })}
        <text x={4} y={top - 14} fontSize={11} fill="var(--muted)">
          Move-in
        </text>
      </svg>
    </div>
  );
}

function Meter({ count, cap }: { count: number; cap: number }) {
  const k = Math.min(cap, 24);
  return (
    <span className="meter" role="img" aria-label={`${count} of ${cap} slots`}>
      {Array.from({ length: k }, (_, i) => {
        const on = i < Math.round((count * k) / cap);
        return <i key={i} className={on ? `on${count === cap ? " full" : ""}` : undefined} />;
      })}
    </span>
  );
}

const zero = (v: number) => (v ? <td>{v}</td> : <td className="z">–</td>);

/** The page itself — the same for the editor and the provider's link. */
function LeaseBody({ s, c }: { s: LeaseSettings; c: LeaseComputed }) {
  const copy = leaseCopy(s, c);
  if (!c.apts.length) {
    return (
      <main>
        <div className="hero">
          <h1>No reservations yet</h1>
          <p className="lede">Load a reservation list (CSV) or use the original list under Edit numbers.</p>
        </div>
      </main>
    );
  }
  return (
    <main>
      <div className="hero">
        <h1>{copy.h1}</h1>
        <p className="lede">{copy.lede}</p>
        <div className="facts">
          {copy.facts.map((f) => (
            <div key={f.s} className={`fact${f.cap ? " cap" : ""}`}>
              <b>{f.b}</b>
              <span>{f.s}</span>
            </div>
          ))}
        </div>
      </div>

      <section>
        <h2>Rental periods</h2>
        <p className="sub">Each bar is a group of apartments with the same move-in and hand-back dates. Thicker bars hold more apartments; the number at the end is the count.</p>
        <div className="chart">
          <Gantt c={c} />
          <div className="legend">
            <span>
              <i style={{ background: "var(--bar)" }} />
              Leased to We Lodge
            </span>
            <span>
              <i style={{ background: "var(--games)" }} />
              Games periods
            </span>
          </div>
        </div>
      </section>

      <section>
        <h2>Hand-backs, week by week</h2>
        <p className="sub">{copy.weeklySub}</p>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Week of</th>
                <th>Handed back</th>
                <th>Returned so far</th>
                <th>Still leased</th>
              </tr>
            </thead>
            <tbody>
              {c.weeks.map((w) => (
                <tr key={w.t}>
                  <td>{fd(w.t)}</td>
                  <td className={w.c ? undefined : "z"}>
                    {w.c}
                    <Meter count={w.c} cap={c.CAP} />
                  </td>
                  <td>{w.back}</td>
                  <td>{w.left}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Month by month</h2>
        <p className="sub">Apartments moving in and handed back each month, how many are leased at month end, and the rent you receive. Part-months are charged by the day.</p>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Moving in</th>
                <th>Handed back</th>
                <th>Leased at month end</th>
                <th>Rent to {copy.short}</th>
              </tr>
            </thead>
            <tbody>
              {c.months.map((r) => (
                <tr key={r.t}>
                  <td>
                    {MONL[new Date(r.t).getUTCMonth()]} {new Date(r.t).getUTCFullYear()}
                  </td>
                  {zero(r.inn)}
                  {zero(r.out)}
                  {zero(r.endL)}
                  <td>{money(r.rent)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{c.N}</td>
                <td>{c.N}</td>
                <td>{one(c.leaseMonths)} lease months</td>
                <td>{money(c.gross)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section>
        <h2>Rent per apartment</h2>
        <p className="sub">Monthly rent by unit type, and the blended average used for the figures above.</p>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Unit type</th>
                <th>Apartments</th>
                <th>Monthly rent</th>
              </tr>
            </thead>
            <tbody>
              {s.mix.map((m, k) => (
                <tr key={k}>
                  <td>{m.t}</td>
                  <td>{c.counts[k]}</td>
                  <td>{money(+m.r || 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Blended average</td>
                <td>{c.mixN}</td>
                <td>{money(c.blended)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="why">
        <h2>Why this shape works for you</h2>
        <h3>A steady flow, never a flood</h3>
        <p>{copy.why1}</p>
        <h3>Everything back while people are looking</h3>
        <p>{copy.why2}</p>
        <h3>Rent for the months that are used</h3>
        <p>{copy.why3}</p>
      </section>

      <section className="terms">
        <h2>
          Proposed terms<span className="pill">For discussion</span>
        </h2>
        <ol>
          <li>
            <b>One tenant, one contact.</b> We Lodge signs as the single corporate tenant, with one point of contact for your team from move-in to the last hand-back.
          </li>
          <li>
            <b>Rent paid in advance.</b> Rent for each move-in wave is paid in advance, with a deposit held per apartment.
          </li>
          <li>
            <b>Damage and liability cover.</b> Every apartment is insured for damage and liability, with a joint inspection at move-in and at hand-back.
          </li>
          <li>
            <b>Professional cleaning.</b> Each apartment is professionally cleaned on departure, so it can be shown straight away.
          </li>
          <li>
            <b>Flexible arrivals, fixed hand-backs.</b>
            {copy.flex}
          </li>
          <li>
            <b>Proven on large international projects.</b> We Lodge has housed teams on major projects in Qatar, France, Japan and Italy.
          </li>
        </ol>
      </section>

      <section className="notes">
        <h2>Notes</h2>
        <p>{copy.note1}</p>
        <p>{copy.note2}</p>
        <p>{copy.note3}</p>
      </section>
    </main>
  );
}

/** The dark band: We Lodge × the provider, the version, Edit numbers (editor) and Save as PDF. */
function Band({ s, onEdit, editOpen, editRef }: { s: LeaseSettings; onEdit?: () => void; editOpen?: boolean; editRef?: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <header className="band">
      <div className="band-in">
        <div className="brand">
          <span className="slash">{"//"}</span>We Lodge<span className="x">×</span>
          <span>{s.provider}</span>
        </div>
        <div className="ver">{s.version}</div>
        {onEdit && (
          <button ref={editRef} className="btn alt no-print" type="button" aria-controls="lease-drawer" aria-expanded={editOpen} onClick={onEdit}>
            Edit numbers
          </button>
        )}
        <button className="btn no-print" type="button" onClick={() => window.print()}>
          Save as PDF
        </button>
      </div>
    </header>
  );
}

/**
 * A number box that lets you type freely: what reads as a valid number is
 * applied at once; it catches up with outside changes when not being typed in.
 */
function NumberBox({ value, onValue, label, min, max, step, valid }: { value: number; onValue: (v: number) => void; label: string; min?: number; max?: number; step?: number; valid?: (v: number) => boolean }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === "") return;
        const v = Number(e.target.value);
        if (Number.isFinite(v) && (!valid || valid(v))) onValue(v);
      }}
    />
  );
}

/** A date box: only a whole, real date is applied — as the reference. */
function DateBox({ value, onValue, label }: { value: string; onValue: (v: string) => void; label: string }) {
  return (
    <label className="f">
      {label}
      <input type="date" defaultValue={value} key={value} onChange={(e) => okDate(e.target.value) && onValue(e.target.value)} />
    </label>
  );
}

/** The reference's *Edit numbers* panel, every box, saved to the scenario for everyone. */
function Drawer({
  open,
  onClose,
  s,
  onChange,
  reservations,
  onReservations,
  warnings,
}: {
  open: boolean;
  onClose: () => void;
  s: LeaseSettings;
  onChange: (s: LeaseSettings) => void;
  reservations: Reservation[];
  onReservations: (rows: Reservation[]) => void;
  warnings: string[];
}) {
  const unitsRef = useRef<HTMLDivElement>(null);
  const [csvProblem, setCsvProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) unitsRef.current?.querySelector("input")?.focus();
  }, [open]);
  const set = <K extends keyof LeaseSettings>(key: K, value: LeaseSettings[K]) => onChange({ ...s, [key]: value });
  const text = (key: "provider" | "client" | "version" | "waves", label: string, placeholder?: string) => (
    <label className="f">
      {label}
      <input value={s[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} />
    </label>
  );
  return (
    <>
      {open && <div className="scrim no-print" onClick={onClose} />}
      <aside id="lease-drawer" className={`drawer${open ? " open" : ""}`} aria-label="Edit numbers" aria-hidden={!open}>
        <div className="dh">
          <h2>Edit numbers</h2>
          <button className="xbtn" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="db">
          <div className="grp">
            <h3>Names</h3>
            <div className="r2">
              {text("provider", "Provider")}
              {text("client", "Client")}
            </div>
            {text("version", "Version label")}
          </div>
          <div className="grp">
            <h3>Apartments and rent</h3>
            <div className="f" ref={unitsRef}>
              Apartments to lease
              <NumberBox value={s.units} label="Apartments to lease" min={1} max={2000} step={1} valid={(v) => Math.round(v) >= 1 && v <= 2000} onValue={(v) => onChange(setUnits(s, v))} />
            </div>
            <div className="mixg">
              <span>Unit type</span>
              <span>Count</span>
              <span>Rent / month</span>
              {s.mix.map((m, k) => (
                <MixRow key={k} index={k} s={s} onChange={onChange} />
              ))}
            </div>
            <p className="hint">Changing the total rescales the unit mix. Changing a unit count changes the total.</p>
          </div>
          <div className="grp">
            <h3>Move-ins and hand-backs</h3>
            <div className="f">
              Weekly hand-back cap
              <NumberBox value={s.cap} label="Weekly hand-back cap" min={1} max={500} step={1} valid={(v) => v >= 1 && v <= 500} onValue={(v) => set("cap", Math.round(v))} />
            </div>
            <div className="r2">
              {text("waves", "Move-in days of the month", "1, 15")}
              <label className="f">
                Hand-back day
                <select value={s.dow} onChange={(e) => set("dow", Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <option key={d} value={d}>
                      {DOW[d]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="r2">
              <DateBox label="Earliest move-in" value={s.earliest} onValue={(v) => set("earliest", v)} />
              <DateBox label="Latest hand-back" value={s.latest} onValue={(v) => set("latest", v)} />
            </div>
            <label className="f">
              No hand-backs before
              <select value={s.minback} onChange={(e) => set("minback", e.target.value as MinBack)}>
                <option value="none">No limit</option>
                <option value="g1">End of Games period 1</option>
                <option value="g2">End of Games period 2</option>
              </select>
            </label>
            <div className="f">
              Arrival flexibility per wave (days)
              <NumberBox value={s.flex} label="Arrival flexibility per wave (days)" min={0} max={60} step={1} valid={(v) => v >= 0 && v <= 60} onValue={(v) => set("flex", Math.round(v))} />
            </div>
            {warnings.length > 0 && (
              <p className="warn" role="status">
                {warnings.join(" ")}
              </p>
            )}
          </div>
          <div className="grp">
            <h3>Target event</h3>
            <div className="r2">
              <DateBox label="Games period 1 opens" value={s.t_open} onValue={(v) => set("t_open", v)} />
              <DateBox label="Games period 1 closes" value={s.t_close1} onValue={(v) => set("t_close1", v)} />
            </div>
            <div className="r2">
              <DateBox label="Games period 2 opens" value={s.t_open2} onValue={(v) => set("t_open2", v)} />
              <DateBox label="Games period 2 closes" value={s.t_close2} onValue={(v) => set("t_close2", v)} />
            </div>
          </div>
          <div className="grp">
            <h3>Reference event</h3>
            <div className="r2">
              <DateBox label="Opening" value={s.r_open} onValue={(v) => set("r_open", v)} />
              <DateBox label="First closing" value={s.r_close1} onValue={(v) => set("r_close1", v)} />
            </div>
            <DateBox label="Second closing" value={s.r_close2} onValue={(v) => set("r_close2", v)} />
            <p className="hint">
              {isSeed(reservations) ? "Original list" : "Your uploaded list"}: {reservations.length} reservations.
            </p>
            <label className="lbtn">
              Load reservation list (CSV)
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void file.text().then((content) => {
                    const read = parseReservationCsv(content);
                    if ("problem" in read) return setCsvProblem(read.problem);
                    setCsvProblem(null);
                    onReservations(read.rows);
                  });
                }}
              />
            </label>
            <button className="lbtn" type="button" disabled={isSeed(reservations)} onClick={() => onReservations(seedList())}>
              Use original list
            </button>
            {csvProblem && (
              <p className="warn" role="alert">
                {csvProblem}
              </p>
            )}
            <p className="hint">The CSV needs a check-in and check-out date (YYYY-MM-DD) on each line. Loading one replaces the list for this scenario.</p>
          </div>
          <div className="grp" style={{ border: 0 }}>
            <button
              className="lbtn"
              type="button"
              onClick={() => {
                if (!window.confirm("Reset every number and the reservation list to the original? This changes the scenario for everyone, including the provider's link.")) return;
                onChange(leaseDefaults());
                onReservations(seedList());
              }}
            >
              Reset everything
            </button>
            <p className="hint">Changes are saved to this scenario as you type, for everyone — the provider&apos;s link shows them too.</p>
          </div>
        </div>
      </aside>
    </>
  );
}

function MixRow({ index, s, onChange }: { index: number; s: LeaseSettings; onChange: (s: LeaseSettings) => void }) {
  const m = s.mix[index]!;
  const patch = (p: Partial<typeof m>) => onChange({ ...s, mix: s.mix.map((x, k) => (k === index ? { ...x, ...p } : x)) });
  return (
    <>
      <input value={m.t} aria-label={`Unit type ${index + 1}`} onChange={(e) => patch({ t: e.target.value })} />
      <NumberBox value={m.n} label={`${m.t || `Unit type ${index + 1}`} count`} min={0} step={1} valid={(v) => v >= 0} onValue={(v) => onChange(setCount(s, index, v))} />
      <NumberBox value={m.r} label={`${m.t || `Unit type ${index + 1}`} monthly rent`} min={0} step={50} valid={(v) => v >= 0} onValue={(v) => patch({ r: Math.max(0, v) })} />
    </>
  );
}

/** The provider's read-only view, by its share link: no OS around it, no drawer. */
export function LeaseClientView({ lease, reservations }: { lease: LeaseSettings; reservations: Reservation[] }) {
  const c = useMemo(() => computeLease(lease, reservations), [lease, reservations]);
  return (
    <div className={`sl sl-auto sl-page ${lato.variable}`}>
      <Band s={lease} />
      <LeaseBody s={lease} c={c} />
    </div>
  );
}

type Scenario = Extract<NonNullable<RouterOutputs["stagger"]["byId"]>, { kind: "lease" }>;
type Status = "saved" | "dirty" | "saving" | "conflict" | "error";
const who = (person?: { name: string | null; email: string | null } | null) => person?.name ?? person?.email ?? "someone";
const when = (date: Date) => `${formatDate(date)} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

/**
 * The lease editor (doc §4.12): the reference page with its *Edit numbers*
 * drawer, saved as you go — 600 ms after the last change — naming the version
 * it was made from, so a colleague's newer save is never overwritten.
 */
export function LeaseEditor({ scenario }: { scenario: Scenario }) {
  const [lease, setLease] = useState<LeaseSettings>(scenario.lease);
  const [reservations, setReservations] = useState<Reservation[]>(scenario.reservations);
  const [meta, setMeta] = useState({ name: scenario.name, event: scenario.event ?? "" });
  const [status, setStatus] = useState<Status>("saved");
  const [problem, setProblem] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<{ at: Date; by: string }>({ at: scenario.updatedAt, by: who(scenario.updatedBy) });
  const [sharing, setSharing] = useState(false);
  const [open, setOpen] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const c = useMemo(() => computeLease(lease, reservations), [lease, reservations]);
  const warnings = useMemo(() => leaseWarnings(c), [c]);

  useEffect(() => {
    document.title = leaseTitle(lease);
  }, [lease]);

  type Pending = { lease: LeaseSettings; reservations?: Reservation[]; meta: typeof meta };
  const seen = useRef<Date>(scenario.updatedAt);
  const pending = useRef<Pending | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  const save = api.stagger.update.useMutation();

  const flush = useCallback(async () => {
    if (inFlight.current || !pending.current || stopped.current) return;
    const next = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus("saving");
    try {
      const row = await save.mutateAsync({
        id: scenario.id,
        seen: seen.current,
        lease: next.lease,
        ...(next.reservations && { reservations: next.reservations }),
        name: next.meta.name.trim() || scenario.name,
        event: next.meta.event,
        // The list's Owner column is the provider.
        clientLabel: next.lease.provider,
      });
      seen.current = row.updatedAt;
      setLastSaved({ at: row.updatedAt, by: who(row.updatedBy) });
      inFlight.current = false;
      if (pending.current) void flush();
      else setStatus("saved");
    } catch (error) {
      inFlight.current = false;
      const code = (error as { data?: { code?: string } }).data?.code;
      if (code === "CONFLICT") {
        stopped.current = true;
        setStatus("conflict");
        setProblem((error as Error).message);
      } else {
        // Keep what did not go, reservations included, for the next try.
        const later = pending.current as Pending | null;
        pending.current = later ? { ...next, ...later, reservations: later.reservations ?? next.reservations } : next;
        setStatus("error");
        setProblem(friendlyError(error as Parameters<typeof friendlyError>[0]) ?? "Not saved.");
      }
    }
  }, [save, scenario.id, scenario.name]);

  const queue = (patch: Partial<Pending>) => {
    if (stopped.current) return;
    const base: Pending = pending.current ?? { lease, meta };
    pending.current = { ...base, ...patch, reservations: patch.reservations ?? base.reservations };
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const close = () => {
    setOpen(false);
    editRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- close only reads refs

  const statusText =
    status === "saving" ? "Saving…" : status === "dirty" ? "Unsaved changes…" : status === "conflict" ? "Not saved" : status === "error" ? "Not saved — retrying on your next change" : `Saved · ${when(lastSaved.at)} by ${lastSaved.by}`;

  return (
    <div className="-mx-6 -my-8">
      <div className="border-ink-200/60 flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3 md:px-8 print:hidden">
        <Link href="/stagger" className="text-ink-500 hover:text-brand-700 text-[13px]">
          ← All scenarios
        </Link>
        <input
          value={meta.name}
          onChange={(e) => {
            const next = { ...meta, name: e.target.value };
            setMeta(next);
            queue({ meta: next });
          }}
          aria-label="Scenario name"
          className="text-ink-900 hover:border-ink-200 focus:border-brand-400 min-w-48 flex-1 rounded-md border border-transparent px-2 py-1 text-[15px] font-medium outline-none"
        />
        <span className="bg-brand-50 text-brand-800 rounded-full px-2.5 py-0.5 text-[11px] font-medium">Staggered lease</span>
        <input
          value={meta.event}
          onChange={(e) => {
            const next = { ...meta, event: e.target.value };
            setMeta(next);
            queue({ meta: next });
          }}
          placeholder="Event, e.g. LA28"
          aria-label="Event"
          className="border-ink-200 focus:border-brand-400 w-28 rounded-md border px-2 py-1 text-[13px] outline-none"
        />
        <span role="status" aria-live="polite" className={`text-[12px] font-light ${status === "conflict" || status === "error" ? "text-[#c03654]" : "text-ink-500"}`}>
          {statusText}
        </span>
        <Button type="button" variant="secondary" onClick={() => setSharing(true)}>
          Share link
        </Button>
      </div>
      {status === "conflict" && (
        <div className="flex flex-wrap items-center gap-3 bg-[#fde8ec] px-4 py-3 text-[13px] text-[#a3243d] md:px-8 print:hidden">
          <span className="font-medium">{problem ?? "Someone else changed this scenario – reload."}</span>
          <span className="font-light">Your latest change was not saved, so nothing of theirs was overwritten.</span>
          <button type="button" onClick={() => window.location.reload()} className="ml-auto rounded-full bg-[#a3243d] px-4 py-1.5 font-medium text-white">
            Reload
          </button>
        </div>
      )}
      <div className={`sl ${lato.variable}`}>
        <Band s={lease} onEdit={() => setOpen(true)} editOpen={open} editRef={editRef} />
        {warnings.length > 0 && !open && (
          <div className="no-print" style={{ maxWidth: 1040, margin: "16px auto 0", padding: "0 24px" }}>
            <p className="warn" role="status">
              {warnings.join(" ")}
            </p>
          </div>
        )}
        <LeaseBody s={lease} c={c} />
        <Drawer
          open={open}
          onClose={close}
          s={lease}
          onChange={(next) => {
            setLease(next);
            queue({ lease: next });
          }}
          reservations={reservations}
          onReservations={(rows) => {
            setReservations(rows);
            queue({ reservations: rows });
          }}
          warnings={warnings}
        />
      </div>
      {sharing && <ShareDialog id={scenario.id} initial={{ shareEnabled: scenario.shareEnabled, shareToken: scenario.shareToken }} onClose={() => setSharing(false)} />}
    </div>
  );
}

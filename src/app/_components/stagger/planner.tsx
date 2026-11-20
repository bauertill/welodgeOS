"use client";

import "~/styles/stagger.css";

import { Lato } from "next/font/google";
import { useEffect, useMemo, useRef, useState } from "react";

import { drawGantt, PRINT_WIDTH } from "~/app/_components/stagger/charts";
import {
  addWave,
  basis,
  clampInt,
  compute,
  defaults,
  facts,
  lede,
  money,
  MONL,
  NPM,
  num,
  ownerShort,
  regen,
  removeWave,
  setStay,
  setTotal,
  syncTotal,
  TYPES,
  type Computed,
  type StaggerData,
} from "~/lib/stagger-model";

// Lato, as the reference page; served from our own domain by Next.
const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato" });

/** The planner's outer frame: Lato, the reference colours, and presenting mode. */
export function StaggerFrame({ presenting, auto, page, children }: { presenting: boolean; auto?: boolean; page?: boolean; children: React.ReactNode }) {
  return <div className={`stg ${lato.variable} ${presenting ? "presenting" : ""} ${auto ? "stg-auto" : ""} ${page ? "stg-page" : ""}`}>{children}</div>;
}

/** The dark band: We Lodge × the owner, Save as PDF, and (in the editor) Hide settings. */
export function StaggerBand({ owner, presenting, onToggle }: { owner: string; presenting?: boolean; onToggle?: () => void }) {
  return (
    <header className="band">
      <div className="band-inner">
        <div className="brand">
          <span className="slash">{"//"}</span>
          <span>We Lodge</span>
          <span className="x">×</span>
          <span>{owner}</span>
        </div>
        <div className="band-buttons">
          {/* The browser's print dialog, with the print layout: two Letter pages, the rent table on the second. */}
          <button className="btn btn-band no-print" type="button" onClick={() => window.print()}>
            Save as PDF
          </button>
          {onToggle && (
            <button className="btn btn-band no-print" type="button" onClick={onToggle}>
              {presenting ? "Show settings" : "Hide settings"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** "Prepared for … by We Lodge, <today>. Confidential." — printed only; dated in the browser, so the server's day never shows. */
function Prepared({ owner }: { owner: string }) {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);
  return <p className="print-only prepared">{today && `Prepared for ${owner} by We Lodge, ${MONL[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}. Confidential.`}</p>;
}

/** The page body as the owner sees it: the story, the rental periods, the tables and how the figures are built. */
export function StaggerBody({ data, owner, c }: { data: StaggerData; owner: string; c: Computed }) {
  const short = ownerShort(owner);
  return (
    <main>
      <Prepared owner={owner} />
      <h1>OBS in {short} apartments: phased in, phased out</h1>
      <p className="lede">{lede(c)}</p>
      <div className="facts">
        {!c.empty &&
          facts(c, data, short).map((f) => (
            <div key={f.small} className={`fact${f.key ? " key" : ""}`}>
              <b>{f.big}</b>
              <span>{f.small}</span>
            </div>
          ))}
      </div>

      <section className="section">
        <h2>Rental periods</h2>
        <p className="sub">Each bar is one group of apartments, from move-in to hand-back.</p>
        <div className="chart">
          <Gantt c={c} />
          <div className="legend">
            <span>
              <i className="sw-in" />
              Apartments in use, from move-in to hand-back
            </span>
            <span>
              <i className="sw-games" />
              Games period, Jul 14–30
            </span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Month by month</h2>
        <p className="sub">
          {data.showRent ? `Apartments moving in and handed back each month, and the rent ${short} receives. Part-months are pro-rated by day.` : "Apartments moving in and handed back each month."}
        </p>
        <div className="tablewrap">
          <MonthTable c={c} showRent={data.showRent} short={short} />
        </div>
      </section>

      {data.showRent && !c.empty && (
        <section className="section rates">
          <h2>Rent per apartment</h2>
          <p className="sub">Monthly lease rent by unit type, and what it works out to per night.</p>
          <div className="tablewrap">
            <RateTable c={c} data={data} />
          </div>
        </section>
      )}

      <section className="basis">
        <h2>How these figures are built</h2>
        {basis().map((p) => (
          <p key={p.label}>
            <span className={`tag ${p.tag}`}>{p.label}</span>
            {p.text}
          </p>
        ))}
      </section>
    </main>
  );
}

/** Redraw on change and when the chart's width changes, as the reference does. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(node.clientWidth));
    });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

/** The rental periods; redrawn at the printed page's width while printing, as the reference. */
function Gantt({ c }: { c: Computed }) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    drawGantt(node, c);
    const forPrint = () => drawGantt(node, c, PRINT_WIDTH);
    const afterPrint = () => drawGantt(node, c);
    window.addEventListener("beforeprint", forPrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", forPrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [c, width]);
  return <div ref={host} />;
}

function MonthTable({ c, showRent, short }: { c: Computed; showRent: boolean; short: string }) {
  if (c.empty) return <table className="data" />;
  const cell = (v: number) => <td className={v ? undefined : "zero"}>{v ? num(v) : "–"}</td>;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Month</th>
          <th>Moving in</th>
          <th>Handed back</th>
          <th>In-house at month end</th>
          {showRent && <th>Rent to {short}</th>}
        </tr>
      </thead>
      <tbody>
        {c.months
          .filter((M) => M.arr || M.dep || M.endOcc || M.rent > 0.5)
          .map((M) => (
            <tr key={M.m.toISOString()}>
              <td>
                {MONL[M.m.getUTCMonth()]} {M.m.getUTCFullYear()}
              </td>
              {cell(M.arr)}
              {cell(M.dep)}
              {cell(M.endOcc)}
              {showRent && <td>{money(M.rent)}</td>}
            </tr>
          ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td>{num(c.N)}</td>
          <td>{num(c.N)}</td>
          <td>{num(c.unitMonths)} lease months</td>
          {showRent && <td>{money(c.totalRent)}</td>}
        </tr>
      </tfoot>
    </table>
  );
}

function RateTable({ c, data }: { c: Extract<Computed, { empty: false }>; data: StaggerData }) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Unit type</th>
          <th>Apartments</th>
          <th>Per month</th>
          <th>Per night</th>
        </tr>
      </thead>
      <tbody>
        {TYPES.map((ty, k) => {
          const rate = +data.rates[ty.k] || 0;
          const n = c.counts[k]!;
          return (
            <tr key={ty.k}>
              <td>{ty.label}</td>
              <td className={n ? undefined : "zero"}>{n ? num(n) : "–"}</td>
              <td>{money(rate)}</td>
              <td>{money(rate / NPM)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td>Blended average</td>
          <td>{num(c.N)}</td>
          <td>{money(c.rateEff)}</td>
          <td>{money(c.rateEff / NPM)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * A number box that lets you type freely: each keystroke that reads as a
 * number is applied at once (as the reference's input events), and the box
 * catches up with outside changes when you are not typing in it.
 */
function NumberInput({
  value,
  onValue,
  parse,
  ...rest
}: { value: number; onValue: (n: number) => void; parse: (text: string) => number | null } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  return (
    <input
      {...rest}
      type="number"
      value={focused ? text : String(value)}
      onFocus={() => {
        setText(String(value));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n !== null) onValue(n);
      }}
    />
  );
}

const intParser = (lo: number, hi: number) => (text: string) => (text.trim() === "" || isNaN(parseInt(text, 10)) ? null : clampInt(text, lo, hi, lo));

/** The settings panel, with the reference's rules: see the model's setTotal, regen, setStay, addWave. */
export function StaggerPanel({ data, owner, onChange }: { data: StaggerData; owner: string; onChange: (next: StaggerData) => void }) {
  const night = data.rateBasis === "night";
  return (
    <aside className="panel" aria-label="Scenario settings">
      <details open>
        <summary>Scenario settings</summary>

        <div className="group">
          <h3>Size and timing</h3>
          <label className="field">
            Total apartments
            <NumberInput min={0} max={2000} step={1} value={data.units} parse={intParser(0, 2000)} onValue={(n) => onChange(setTotal(data, n))} />
          </label>
          <div className="quick">
            {[50, 100, 200, 245].map((n) => (
              <button key={n} type="button" className={`btn${data.units === n ? " on" : ""}`} onClick={() => onChange(setTotal(data, n))}>
                {n}
              </button>
            ))}
          </div>
          <label className="field">
            First move-in
            <input type="date" value={data.first} onChange={(e) => e.target.value && onChange(regen({ ...data, first: e.target.value }))} />
          </label>
          <div className="row2">
            <label className="field">
              Arrival waves
              <NumberInput min={1} max={40} step={1} value={data.waves} parse={intParser(1, 40)} onValue={(n) => onChange(regen({ ...data, waves: n }))} />
            </label>
            <label className="field">
              Days between waves
              <NumberInput min={1} max={60} step={1} value={data.gap} parse={intParser(1, 60)} onValue={(n) => onChange(regen({ ...data, gap: n }))} />
            </label>
          </div>
          <label className="field">
            Stay per apartment (months)
            <NumberInput min={1} max={12} step={1} value={data.stay} parse={intParser(1, 12)} onValue={(n) => onChange(setStay(data, n))} />
          </label>
          <p className="hint">Changing these rebuilds the waves evenly. Changing only the total keeps your wave dates and rescales the numbers.</p>
        </div>

        <div className="group">
          <h3>Waves</h3>
          <table className="waves">
            <thead>
              <tr>
                <th>Move-in</th>
                <th>Units</th>
                <th>Months</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const setRow = (patch: Partial<typeof r>, sync = false) => {
                  const next = { ...data, rows: data.rows.map((row, j) => (j === i ? { ...row, ...patch } : row)) };
                  onChange(sync ? syncTotal(next) : next);
                };
                return (
                  <tr key={i}>
                    <td>
                      <input type="date" aria-label={`Wave ${i + 1} date`} value={r.date} onChange={(e) => e.target.value && setRow({ date: e.target.value })} />
                    </td>
                    <td>
                      <NumberInput aria-label={`Wave ${i + 1} units`} min={0} max={2000} step={1} style={{ width: 58 }} value={r.units} parse={intParser(0, 2000)} onValue={(n) => setRow({ units: n }, true)} />
                    </td>
                    <td>
                      <NumberInput aria-label={`Wave ${i + 1} stay`} min={1} max={24} step={1} style={{ width: 48 }} value={r.stay} parse={intParser(1, 24)} onValue={(n) => setRow({ stay: n })} />
                    </td>
                    <td>
                      <button className="del" type="button" aria-label={`Remove wave ${i + 1}`} onClick={() => onChange(removeWave(data, i))}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn" type="button" style={{ marginTop: 8 }} onClick={() => onChange(addWave(data))}>
            Add wave
          </button>
        </div>

        <div className="group">
          <h3>Unit mix and rent</h3>
          <div className="quick" style={{ margin: "0 0 10px" }}>
            {(
              [
                ["month", "Enter monthly"],
                ["night", "Enter nightly"],
              ] as const
            ).map(([basisKey, label]) => (
              <button key={basisKey} type="button" className={`btn${data.rateBasis === basisKey ? " on" : ""}`} onClick={() => onChange({ ...data, rateBasis: basisKey })}>
                {label}
              </button>
            ))}
          </div>
          <table className="mix">
            <thead>
              <tr>
                <th />
                <th>Share %</th>
                <th>{night ? "Rent / night" : "Rent / month"}</th>
              </tr>
            </thead>
            <tbody>
              {TYPES.map((t) => (
                <tr key={t.k}>
                  <td>{t.label}</td>
                  <td>
                    <NumberInput aria-label={`${t.label} share`} min={0} max={100} step={1} value={data.mix[t.k]} parse={(text) => clampInt(text, 0, 100, 0)} onValue={(n) => onChange({ ...data, mix: { ...data.mix, [t.k]: n } })} />
                  </td>
                  <td>
                    <NumberInput
                      key={data.rateBasis}
                      aria-label={`${t.label} ${night ? "nightly" : "monthly"} rent`}
                      min={0}
                      step={night ? 1 : 50}
                      value={night ? Math.round(data.rates[t.k] / NPM) : Math.round(data.rates[t.k])}
                      parse={(text) => {
                        const v = parseFloat(text);
                        return isNaN(v) || v < 0 ? 0 : v;
                      }}
                      onValue={(v) => onChange({ ...data, rates: { ...data.rates, [t.k]: night ? v * NPM : v } })}
                    />
                    <div className="eq">{night ? `= ${money(data.rates[t.k])}/month` : `= ${money(data.rates[t.k] / NPM)}/night`}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Rents are proposed rates, not yet agreed with {ownerShort(owner)}. Enter them per month or per night; nightly equivalents use 30.4 nights per month (365 ÷ 12).</p>
        </div>

        <div className="group">
          <h3>Display</h3>
          <label className="check">
            <input type="checkbox" checked={data.showRent} onChange={(e) => onChange({ ...data, showRent: e.target.checked })} />
            Show rent figures
          </label>
          <button className="btn" type="button" style={{ marginTop: 6 }} onClick={() => window.confirm("Reset this scenario to the 50-unit scenario? Everyone sees the change.") && onChange(defaults())}>
            Reset to 50-unit scenario
          </button>
        </div>
      </details>
    </aside>
  );
}

/** The owner's read-only view (doc §4.12): presenting mode, no settings, no OS around it. */
export function StaggerClientView({ data, clientLabel }: { data: StaggerData; clientLabel: string }) {
  const c = useMemo(() => compute(data), [data]);
  return (
    <StaggerFrame presenting auto page>
      <StaggerBand owner={clientLabel} />
      <div className="wrap">
        <StaggerBody data={data} owner={clientLabel} c={c} />
      </div>
    </StaggerFrame>
  );
}

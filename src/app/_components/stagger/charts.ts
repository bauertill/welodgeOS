import * as d3 from "d3";

import { addDays, addMonths, DAY, fd, fdy, GAMES, iso, type Computed } from "~/lib/stagger-model";

/**
 * The Stagger Planner's two charts (doc §4.12), drawn with d3 exactly as the
 * reference page draws them: apartments in use day by day, with the check-in
 * and hand-back strip, and the arrival waves. Browser only.
 */

type Full = Extract<Computed, { empty: false }>;

function el(tag: string, cls?: string | null, text?: string | null) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const xScale = (c: Full, W: number, l: number, r: number) => d3.scaleUtc().domain([c.start, c.end]).range([l, W - r]);

function monthAxis(g: d3.Selection<SVGGElement, unknown, null, undefined>, x: d3.ScaleTime<number, number>, narrow: boolean) {
  const ax = d3
    .axisBottom<Date>(x)
    .ticks(d3.utcMonth.every(narrow ? 2 : 1)!)
    .tickFormat(d3.utcFormat("%b"))
    .tickSizeOuter(0);
  g.attr("class", "ax").call(ax);
}

/** Apartments in use per day, the single-block outline and the in / out strip, with a tooltip. */
export function drawMain(host: HTMLElement, tip: HTMLElement, wrap: HTMLElement, c: Computed, showBlock: boolean) {
  host.innerHTML = "";
  if (c.empty) {
    host.appendChild(el("div", "empty", "No apartments in the plan yet."));
    return;
  }
  const W = host.clientWidth || 600;
  const narrow = W < 560;
  const m = { t: 36, r: 12, b: 26, l: 40 };
  const hA = narrow ? 210 : 280;
  const gap = 22;
  const hS = narrow ? 84 : 104;
  const H = m.t + hA + gap + hS + m.b;
  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", `Apartments in use per day, from ${fd(c.minA)} to ${fdy(c.maxD)}`);
  const x = xScale(c, W, m.l, m.r);
  const y = d3
    .scaleLinear()
    .domain([0, c.N * 1.14 || 1])
    .range([m.t + hA, m.t]);

  const gx0 = x(GAMES[0]);
  const gx1 = x(GAMES[1]);
  svg.append("rect").attr("class", "games").attr("x", gx0).attr("width", Math.max(2, gx1 - gx0)).attr("y", m.t - 6).attr("height", hA + gap + hS + 6);
  svg
    .append("text")
    .attr("class", "games-label")
    .attr("x", (gx0 + gx1) / 2)
    .attr("y", m.t - 12)
    .attr("text-anchor", "middle")
    .text(narrow ? "Games" : "Games, Jul 14–30");

  svg
    .append("g")
    .selectAll("line")
    .data(y.ticks(4))
    .join("line")
    .attr("class", "gridline")
    .attr("x1", m.l)
    .attr("x2", W - m.r)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d));
  svg
    .append("g")
    .attr("class", "ax")
    .attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").remove());

  const pts = c.occ.map((v, i) => [addDays(c.start, i), v] as [Date, number]);
  svg
    .append("path")
    .datum(pts)
    .attr("class", "area")
    .attr(
      "d",
      d3
        .area<[Date, number]>()
        .curve(d3.curveStepAfter)
        .x((d) => x(d[0]))
        .y0(y(0))
        .y1((d) => y(d[1])),
    );

  if (showBlock) {
    const b0 = c.minA;
    const b1 = addMonths(c.minA, c.rows[0]!.stay);
    svg.append("rect").attr("class", "block").attr("x", x(b0)).attr("y", y(c.N)).attr("width", x(b1) - x(b0)).attr("height", y(0) - y(c.N));
    svg
      .append("text")
      .attr("class", "block-label")
      .attr("x", x(b1) - 4)
      .attr("y", y(c.N) - 7)
      .attr("text-anchor", "end")
      .text(narrow ? `Single block: all ${c.N} back ${fd(b1)}` : `As one block: all ${c.N} handed back on ${fd(b1)}`);
  }

  if (c.fh) {
    const fx0 = x(c.fh[0]);
    const fx1 = x(addDays(c.fh[1], 1));
    if (fx1 - fx0 > 120 && y(0) - y(c.N) > 60) {
      const cx = (fx0 + fx1) / 2;
      svg.append("text").attr("class", "inside").attr("x", cx).attr("y", y(c.N) + 24).attr("text-anchor", "middle").text(`All ${c.N} in-house`);
      svg.append("text").attr("class", "inside small").attr("x", cx).attr("y", y(c.N) + 41).attr("text-anchor", "middle").text(`${fd(c.fh[0])} – ${fd(c.fh[1])}`);
    }
  }

  // The strip of check-ins and hand-backs.
  const top = m.t + hA + gap;
  const mid = top + hS / 2;
  const half = hS / 2 - 14;
  const s = d3
    .scaleLinear()
    .domain([0, Math.max(c.maxIn, c.maxOut) || 1])
    .range([0, half]);
  svg.append("line").attr("class", "baseline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", mid).attr("y2", mid);
  svg.append("text").attr("class", "strip-label").attr("x", 2).attr("y", mid - 4).text("In");
  svg.append("text").attr("class", "strip-label").attr("x", 2).attr("y", mid + 14).text("Out");
  const bw = narrow ? 5 : 7;
  const ev = svg.append("g");
  for (const e of c.events) {
    const ex = x(e.date);
    if (e.arr) {
      ev.append("rect").attr("class", "bar-in").attr("x", ex - bw / 2).attr("width", bw).attr("y", mid - s(e.arr)).attr("height", s(e.arr)).attr("rx", 2);
      ev.append("text").attr("class", "ev-label").attr("x", ex).attr("y", mid - s(e.arr) - 3).attr("text-anchor", "middle").text(e.arr);
    }
    if (e.dep) {
      ev.append("rect").attr("class", "bar-out").attr("x", ex - bw / 2).attr("width", bw).attr("y", mid).attr("height", s(e.dep)).attr("rx", 2);
      ev.append("text").attr("class", "ev-label").attr("x", ex).attr("y", mid + s(e.dep) + 12).attr("text-anchor", "middle").text(e.dep);
    }
  }

  monthAxis(svg.append("g").attr("transform", `translate(0,${top + hS})`), x, narrow);

  // The tooltip, following the pointer day by day.
  const hl = svg.append("line").attr("class", "hover-line").attr("y1", m.t).attr("y2", top + hS).style("display", "none");
  const evByDay: Record<string, { arr: number; dep: number }> = {};
  for (const e of c.events) evByDay[iso(e.date)] = e;
  svg
    .append("rect")
    .attr("x", m.l)
    .attr("y", m.t)
    .attr("width", W - m.l - m.r)
    .attr("height", hA + gap + hS)
    .attr("fill", "transparent")
    .on("pointermove", function (event: PointerEvent) {
      const p = d3.pointer(event, this);
      const d = x.invert(p[0]);
      const i = Math.max(0, Math.min(c.days, Math.floor((d.getTime() - c.start.getTime()) / DAY)));
      const dayDate = addDays(c.start, i);
      const px = x(dayDate);
      hl.style("display", null).attr("x1", px).attr("x2", px);
      tip.innerHTML = "";
      tip.appendChild(el("b", null, fdy(dayDate)));
      tip.appendChild(el("div", null, `${c.occ[i]} of ${c.N} apartments in-house`));
      const e = evByDay[iso(dayDate)];
      if (e?.arr) tip.appendChild(el("div", null, `${e.arr} moving in`));
      if (e?.dep) tip.appendChild(el("div", null, `${e.dep} handed back`));
      const tw = tip.offsetWidth;
      let left = px + 26;
      if (left + tw > wrap.clientWidth - 8) left = px - tw - 2;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${p[1] + 4}px`;
      tip.style.opacity = "1";
    })
    .on("pointerleave", () => {
      hl.style("display", "none");
      tip.style.opacity = "0";
    });
}

/** One bar per arrival wave, move-in to hand-back. */
export function drawGantt(host: HTMLElement, c: Computed) {
  host.innerHTML = "";
  if (c.empty) {
    host.appendChild(el("div", "empty", "No waves yet."));
    return;
  }
  const W = host.clientWidth || 600;
  const narrow = W < 560;
  const m = { t: 10, r: 12, b: 26, l: 40 };
  const rowH = 30;
  const H = m.t + c.rows.length * rowH + m.b;
  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", `${c.rows.length} arrival waves`);
  const x = xScale(c, W, m.l, m.r);
  svg
    .append("rect")
    .attr("class", "games")
    .attr("x", x(GAMES[0]))
    .attr("width", Math.max(2, x(GAMES[1]) - x(GAMES[0])))
    .attr("y", m.t - 4)
    .attr("height", c.rows.length * rowH + 4);
  c.rows.forEach((r, i) => {
    const yy = m.t + i * rowH + 4;
    const h = rowH - 8;
    const x0 = x(r.a);
    const x1 = x(r.d);
    const w = x1 - x0;
    svg.append("text").attr("class", "wave-id").attr("x", 4).attr("y", yy + h / 2 + 4).text(`W${i + 1}`);
    svg.append("rect").attr("class", "wave").attr("x", x0).attr("y", yy).attr("width", Math.max(2, w)).attr("height", h).attr("rx", 6);
    const label = `${r.units}${r.units === 1 ? " unit" : " units"}`;
    const dates = `${fd(r.a)} – ${fd(r.d)}`;
    const full = `${label},  ${dates}`;
    const fits = w > (narrow ? 150 : 170);
    svg
      .append("text")
      .attr("class", "wave-label")
      .attr("x", x0 + 8)
      .attr("y", yy + h / 2 + 4)
      .text(fits ? full : w > 60 ? label : "");
    if (!fits) {
      const outside = w > 60 ? dates : full;
      let tx = x1 + 6;
      let anchor = "start";
      if (tx + outside.length * 6.2 > W - m.r) {
        tx = x0 - 6;
        anchor = "end";
      }
      svg.append("text").attr("class", "wave-out").attr("x", tx).attr("y", yy + h / 2 + 4).attr("text-anchor", anchor).text(outside);
    }
  });
  monthAxis(svg.append("g").attr("transform", `translate(0,${m.t + c.rows.length * rowH})`), x, narrow);
}

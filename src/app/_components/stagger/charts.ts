import * as d3 from "d3";

import { fd, GAMES, type Computed } from "~/lib/stagger-model";

/**
 * The Stagger Planner's chart (doc §4.12), drawn with d3 exactly as the
 * reference page draws it: the rental periods, one bar per wave. Browser only.
 */

/** The drawing width while printing: US Letter less half-inch margins, as the reference. */
export const PRINT_WIDTH = 720;

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

/** One bar per wave, move-in to hand-back. `printWidth` draws at a fixed width for the printed page. */
export function drawGantt(host: HTMLElement, c: Computed, printWidth = 0) {
  host.innerHTML = "";
  if (c.empty) {
    host.appendChild(el("div", "empty", "No waves yet."));
    return;
  }
  const W = printWidth || host.clientWidth || 600;
  const narrow = W < 560;
  const m = { t: 10, r: 12, b: 26, l: 62 };
  const rowH = printWidth ? 26 : 30;
  const H = m.t + c.rows.length * rowH + m.b;
  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", "100%")
    .style("height", "auto")
    .style("display", "block")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", `${c.rows.length} rental periods`);
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
    svg.append("text").attr("class", "wave-id").attr("x", 4).attr("y", yy + h / 2 + 4).text(`Wave ${i + 1}`);
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

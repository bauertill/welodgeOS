import JSZip from "jszip";

/**
 * Reading a spreadsheet a client sends (doc §6.9): an Excel workbook (.xlsx)
 * or a CSV, in the browser, into rows of cells — nothing is uploaded until
 * the rows are matched. Excel dates arrive as day numbers; `cellDate` reads
 * those and the ways people write dates by hand.
 */

export type Cell = string | number | null;
export type ReadSheet = { name: string; rows: Cell[][] };

const columnIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
};

function textOf(node: Element) {
  // Rich text has several <t>; plain has one.
  return [...node.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");
}

async function readXlsx(data: ArrayBuffer): Promise<ReadSheet[]> {
  const zip = await JSZip.loadAsync(data);
  const parse = async (path: string) => {
    const file = zip.file(path);
    return file ? new DOMParser().parseFromString(await file.async("string"), "application/xml") : null;
  };
  const workbook = await parse("xl/workbook.xml");
  const rels = await parse("xl/_rels/workbook.xml.rels");
  if (!workbook) throw new Error("That does not look like an Excel file.");
  const shared = await parse("xl/sharedStrings.xml");
  const strings = shared ? [...shared.getElementsByTagName("si")].map(textOf) : [];
  const targets = new Map(
    [...(rels?.getElementsByTagName("Relationship") ?? [])].map((rel) => [rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? ""]),
  );
  const sheets: ReadSheet[] = [];
  for (const sheet of [...workbook.getElementsByTagName("sheet")]) {
    const id = sheet.getAttribute("r:id") ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const target = (targets.get(id) ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const xml = await parse(`xl/${target}`);
    if (!xml) continue;
    const rows: Cell[][] = [];
    for (const row of [...xml.getElementsByTagName("row")]) {
      const r = Number(row.getAttribute("r") ?? rows.length + 1) - 1;
      const cells: Cell[] = [];
      for (const c of [...row.getElementsByTagName("c")]) {
        const index = columnIndex(c.getAttribute("r") ?? "A");
        const type = c.getAttribute("t");
        const v = c.getElementsByTagName("v")[0]?.textContent ?? null;
        let value: Cell = null;
        if (type === "s" && v !== null) value = strings[Number(v)] ?? null;
        else if (type === "inlineStr") value = textOf(c);
        else if (type === "str" || type === "e") value = v;
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (v !== null) value = Number.isFinite(Number(v)) ? Number(v) : v;
        cells[index] = typeof value === "string" ? value.trim() || null : value;
      }
      rows[r] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? null);
    }
    sheets.push({ name: sheet.getAttribute("name") ?? `Sheet ${sheets.length + 1}`, rows: Array.from({ length: rows.length }, (_, i) => rows[i] ?? []) });
  }
  return sheets;
}

/** A CSV — commas or semicolons, quotes doubled inside quotes. */
function readCsv(text: string): ReadSheet[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === sep) {
      row.push(cell.trim() || null);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim() || null);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell.trim() || null);
    rows.push(row);
  }
  return [{ name: "Sheet 1", rows }];
}

export async function readSheetFile(file: File): Promise<ReadSheet[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return readCsv(await file.text());
  if (lower.endsWith(".xls")) throw new Error("This is the old Excel format (.xls). Please save it as .xlsx or CSV and try again.");
  return readXlsx(await file.arrayBuffer());
}

const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/**
 * A date as written in a sheet, as YYYY-MM-DD — or null. Excel's day numbers,
 * 2028-07-10, 10/07/2028 (day first unless told month first), 10 Jul 2028,
 * July 10 2028, 10-Jul; a missing year is the event's.
 */
export function cellDate(value: Cell, order: "dmy" | "mdy", year: number): string | null {
  if (value === null || value === "") return null;
  if (typeof value === "number") {
    if (value > 20000 && value < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 864e5);
      return date.toISOString().slice(0, 10);
    }
    return null;
  }
  const text = value.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const y = m[3] ? fullYear(Number(m[3])) : year;
    // Day first unless told otherwise — or unless it cannot be.
    const dayFirst = a > 12 ? true : b > 12 ? false : order === "dmy";
    return dayFirst ? iso(y, b, a) : iso(y, a, b);
  }
  m = /^(\d{1,2})[\s-]+([a-z]{3,9})\.?(?:[\s-]+(\d{2,4}))?$/.exec(text);
  if (m && months[m[2]!.slice(0, m[2] === "sept" ? 4 : 3)]) return iso(m[3] ? fullYear(Number(m[3])) : year, months[m[2]!.slice(0, 3)]!, Number(m[1]));
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:\s+(\d{2,4}))?$/.exec(text);
  if (m && months[m[1]!.slice(0, 3)]) return iso(m[3] ? fullYear(Number(m[3])) : year, months[m[1]!.slice(0, 3)]!, Number(m[2]));
  return null;
}

/** A cell as text, numbers as they read. */
export const cellText = (value: Cell) => (value === null ? "" : typeof value === "number" ? String(value) : value.trim());

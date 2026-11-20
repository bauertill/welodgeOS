/**
 * Reading back a client's redlines (doc §4.11, the owner 2026-11-20: "can we
 * not just upload the redline and you pick up the changes?"). The Word draft
 * we sent comes back with their tracked changes and comments; each paragraph
 * of it is lined up with the line of the agreement it came from, and what they
 * changed, added or struck out becomes a change the team can take or leave.
 * Pure: the Word file is read into `WordUnit`s elsewhere (agreement-word-read).
 */

/** One paragraph of the returned Word file, or one row of a table — as it was, and with their changes taken. */
export type WordUnit = {
  /** Paragraphs per cell: one cell of one paragraph for plain text. */
  original: string[][];
  accepted: string[][];
  table: boolean;
  /** Their comments on it. */
  comments: { author: string; text: string }[];
};

export type RedlineChange = {
  id: number;
  kind: "change" | "insert" | "delete";
  /** The clause or schedule it is in, for the reader. */
  where: string;
  before: string;
  after: string;
  comments: { author: string; text: string }[];
  /** For a change or a delete: the agreement line it replaces. For an insert: the line it follows (-1: the very start). */
  line: number;
  /** The line(s) that go in its place, in the agreement's own way of writing. */
  lines: string[];
};

export type RedlineReading = {
  changes: RedlineChange[];
  /** Comments on text they did not change. */
  comments: { where: string; on: string; author: string; text: string }[];
  /** How many paragraphs lined up with ours — a low share means it is not this agreement. */
  matched: number;
  total: number;
};

const plain = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[(missing: [^\]]+)\]/g, "$1");
const squash = (text: string) => text.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
const flat = (cells: string[][]) => squash(cells.map((cell) => cell.join(" ")).join(" | "));

/** What each line of the agreement reads as in the Word draft we made (agreement-docx), in the same order. */
function expected(lines: string[]) {
  const clauses = lines.filter((line) => /^# /.test(line)).map((line) => line.slice(2).trim());
  const out: { line: number; cells: string[][]; derived?: boolean }[] = [];
  lines.forEach((raw, line) => {
    const text = raw.trimEnd();
    if (!text.trim()) return;
    const numbered = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(text);
    if (text.startsWith("= ")) out.push({ line, cells: [[plain(text.slice(2))]] });
    else if (text.startsWith("### ")) out.push({ line, cells: [[plain(text.slice(4))]] });
    else if (text.startsWith("## ")) out.push({ line, cells: [[plain(text.slice(3))]] });
    else if (text.startsWith("# ")) out.push({ line, cells: [[plain(text.slice(2))]] });
    else if (text.trim() === "[[contents]]") {
      out.push({ line, cells: [["CONTENTS"]], derived: true });
      for (const clause of clauses) out.push({ line, cells: [[plain(clause)]], derived: true });
    } else if (text.startsWith("@sign ")) {
      const [who, how] = text.slice(6).split("|");
      out.push({ line, cells: [["", plain(who!.trim()), plain((how ?? "").trim())], ["", "DATE"]] });
    } else if (text.startsWith("|")) out.push({ line, cells: text.replace(/^\||\|$/g, "").split("|").map((cell) => [plain(cell.trim())]) });
    else if (text.startsWith("- ")) out.push({ line, cells: [[plain(text.slice(2))]] });
    else if (numbered) out.push({ line, cells: [[`${numbered[1]}\t${plain(numbered[2]!)}`]] });
    else out.push({ line, cells: [[plain(text)]] });
  });
  return out.filter((unit) => flat(unit.cells));
}

/** Pairs of positions that read the same, in order (longest common subsequence). */
function lineUp(a: string[], b: string[]) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/** Their text written back the agreement's way, keeping the line's marks: its number, heading, bold and gaps still open. */
function rewrite(source: string, cells: string[][]) {
  const text = squash(cells.map((cell) => cell.join(" ")).join(" "));
  const keep = (value: string) => {
    let out = value;
    for (const [, gap] of source.matchAll(/\[(missing: [^\]]+)\]/g)) if (out.includes(gap!)) out = out.replace(gap!, `[${gap}]`);
    for (const [, bold] of source.matchAll(/\*\*([^*]+)\*\*/g)) if (out.includes(bold!) && !out.includes(`**${bold}**`)) out = out.replace(bold!, `**${bold}**`);
    return out;
  };
  if (source.startsWith("|")) return `| ${cells.map((cell) => keep(squash(cell.join(" ")))).join(" | ")} |`;
  if (source.startsWith("@sign ")) {
    const [who = "", how = ""] = (cells[0] ?? []).map(squash).filter(Boolean);
    return `@sign ${keep(who)} | ${keep(how)}`;
  }
  for (const prefix of ["= ", "### ", "## ", "# ", "- "]) if (source.startsWith(prefix)) return prefix + keep(text);
  const numbered = /^(\d+(?:\.\d+)*)\.?\s+/.exec(source);
  if (numbered) {
    const theirs = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(text);
    return theirs ? `${theirs[1]} ${keep(theirs[2]!)}` : `${numbered[1]} ${keep(text)}`;
  }
  return keep(text);
}

/** A paragraph they added, written the agreement's way. */
function added(unit: WordUnit) {
  if (unit.table) return `| ${unit.accepted.map((cell) => squash(cell.join(" "))).join(" | ")} |`;
  const text = squash(unit.accepted.map((cell) => cell.join(" ")).join(" "));
  const numbered = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(text);
  return numbered ? `${numbered[1]} ${numbered[2]}` : text;
}

const readable = (cells: string[][]) => squash(cells.map((cell) => cell.filter(Boolean).join(" ")).filter(Boolean).join(" · "));

/** The client's returned Word file, read against the agreement's text as it stands. */
export function readRedlines(text: string, units: WordUnit[]): RedlineReading {
  const lines = text.split("\n");
  const ours = expected(lines);
  const theirs = units.filter((unit) => flat(unit.original) || flat(unit.accepted));
  const pairs = lineUp(
    ours.map((unit) => flat(unit.cells)),
    theirs.map((unit) => flat(unit.original)),
  );

  const heading = (line: number) => {
    for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
      const l = lines[i]!;
      if (l.startsWith("# ") || l.startsWith("## ")) return plain(l.replace(/^#+ /, ""));
    }
    return "The opening";
  };

  const changes: RedlineChange[] = [];
  const comments: RedlineReading["comments"] = [];
  let id = 0;
  const push = (change: Omit<RedlineChange, "id">) => changes.push({ ...change, id: id++ });

  /** Between two lined-up paragraphs: ours left over were struck out or rewritten, theirs left over were added or rewritten. */
  const gap = (fromOurs: number, toOurs: number, fromTheirs: number, toTheirs: number) => {
    const left = ours.slice(fromOurs, toOurs).filter((unit) => !unit.derived);
    const right = theirs.slice(fromTheirs, toTheirs);
    const both = Math.min(left.length, right.length);
    for (let k = 0; k < both; k++) {
      const unit = left[k]!;
      const word = right[k]!;
      const after = flat(word.accepted);
      push({
        kind: after ? "change" : "delete",
        where: heading(unit.line),
        before: readable(unit.cells),
        after: readable(word.accepted),
        comments: word.comments,
        line: unit.line,
        lines: after ? [rewrite(lines[unit.line]!, word.accepted)] : [],
      });
    }
    for (const unit of left.slice(both)) push({ kind: "delete", where: heading(unit.line), before: readable(unit.cells), after: "", comments: [], line: unit.line, lines: [] });
    const anchor = (fromOurs > 0 ? ours[fromOurs - 1]?.line : undefined) ?? -1;
    for (const word of right.slice(both)) {
      if (!flat(word.accepted)) continue;
      push({ kind: "insert", where: heading(anchor), before: "", after: readable(word.accepted), comments: word.comments, line: anchor, lines: [added(word)] });
    }
  };

  let lastOurs = 0;
  let lastTheirs = 0;
  for (const [i, j] of pairs) {
    gap(lastOurs, i, lastTheirs, j);
    const unit = ours[i]!;
    const word = theirs[j]!;
    if (!unit.derived && flat(word.accepted) !== flat(word.original)) {
      const after = flat(word.accepted);
      push({
        kind: after ? "change" : "delete",
        where: heading(unit.line),
        before: readable(unit.cells),
        after: readable(word.accepted),
        comments: word.comments,
        line: unit.line,
        lines: after ? [rewrite(lines[unit.line]!, word.accepted)] : [],
      });
    } else {
      for (const comment of word.comments) comments.push({ where: heading(unit.line), on: readable(unit.cells).slice(0, 160), ...comment });
    }
    lastOurs = i + 1;
    lastTheirs = j + 1;
  }
  gap(lastOurs, ours.length, lastTheirs, theirs.length);

  return { changes, comments, matched: pairs.length, total: Math.max(ours.length, 1) };
}

/** The agreement with the chosen changes taken in. */
export function applyRedlines(text: string, changes: RedlineChange[]) {
  const lines = text.split("\n");
  const replace = new Map<number, string[]>();
  const after = new Map<number, string[]>();
  for (const change of changes) {
    if (change.kind === "insert") after.set(change.line, [...(after.get(change.line) ?? []), ...change.lines]);
    else replace.set(change.line, change.lines);
  }
  const out: string[] = [...(after.get(-1) ?? [])];
  lines.forEach((line, i) => {
    out.push(...(replace.get(i) ?? [line]));
    out.push(...(after.get(i) ?? []));
  });
  return out.join("\n");
}

/** Words struck out and words added, for showing a change the way Word does. */
export function wordDiff(before: string, after: string) {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 400_000) return [{ kind: "del" as const, text: before }, { kind: "ins" as const, text: after }];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: { kind: "same" | "del" | "ins"; text: string }[] = [];
  const add = (kind: "same" | "del" | "ins", text: string) => {
    const last = out.at(-1);
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) add("same", a[i++]!), j++;
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) add("del", a[i++]!);
    else add("ins", b[j++]!);
  }
  while (i < a.length) add("del", a[i++]!);
  while (j < b.length) add("ins", b[j++]!);
  return out;
}

import {
  AlignmentType,
  BorderStyle,
  Document,
  HighlightColor,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from "docx";

import { readAgreement, type AgreementBlock } from "~/lib/agreement";

/**
 * The agreement as a Word document (doc §4.11, the owner 2026-11-20: "we send
 * the client a draft in PDF and Word, this allows them to make redline
 * changes"). Built in the browser from the same blocks the page draws, so the
 * Word draft says exactly what the PDF says: a wide schedule on a landscape
 * page, [missing: …] highlighted, and plain paragraphs the client can track
 * changes in.
 */

const FONT = "Arial";
const SIZE = 20; // half-points: 10 pt
const TWIP = 1440; // per inch
const WIDE_TABLE = 7;

/** **bold** and [missing: …] as runs; the rest plain. */
function runs(text: string, base: { bold?: boolean; size?: number } = {}) {
  return text
    .split(/(\*\*[^*]+\*\*|\[missing: [^\]]+\])/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**")
        ? new TextRun({ text: part.slice(2, -2), bold: true, font: FONT, size: base.size ?? SIZE })
        : part.startsWith("[missing: ")
          ? new TextRun({ text: part.slice(1, -1), highlight: HighlightColor.YELLOW, font: FONT, size: base.size ?? SIZE, bold: base.bold })
          : new TextRun({ text: part, font: FONT, size: base.size ?? SIZE, bold: base.bold }),
    );
}

const line = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" } as const;
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

function table(rows: string[][], wide: boolean) {
  const size = 16; // 8 pt
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: wide ? TableLayoutType.AUTOFIT : TableLayoutType.FIXED,
    borders: { top: none, left: none, right: none, insideVertical: none, bottom: line, insideHorizontal: line },
    rows: rows.map(
      (row, r) =>
        new TableRow({
          tableHeader: r === 0,
          children: row.map(
            (cell) =>
              new TableCell({
                margins: { top: 40, bottom: 40, left: 60, right: 60 },
                children: [new Paragraph({ children: r === 0 ? [new TextRun({ text: cell, bold: true, font: FONT, size })] : runs(cell, { size }) })],
              }),
          ),
        }),
    ),
  });
}

/** A signature block: a line to sign on, who and in what capacity, and a line for the date. */
function sign(who: string, how: string) {
  const signLine = new Paragraph({ spacing: { before: 600 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } }, children: [] });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, borders: noBorders, margins: { right: 400 }, children: [signLine, new Paragraph({ children: runs(who) }), new Paragraph({ children: runs(how) })] }),
          new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, borders: noBorders, children: [signLine, new Paragraph({ children: [new TextRun({ text: "DATE", font: FONT, size: SIZE })] })] }),
        ],
      }),
    ],
  });
}

function block(item: AgreementBlock, wide: boolean, first: boolean): (Paragraph | Table)[] {
  switch (item.kind) {
    case "title":
      return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: item.text, bold: true, font: FONT, size: 32 })] })];
    case "clause":
      return [new Paragraph({ keepNext: true, spacing: { before: 320, after: 120 }, children: [new TextRun({ text: item.text, bold: true, font: FONT, size: 22 })] })];
    case "schedule":
      // A schedule starts a new page — unless it already opens a section of its own (a landscape one).
      return [new Paragraph({ alignment: AlignmentType.CENTER, pageBreakBefore: !first, spacing: { after: 160 }, children: [new TextRun({ text: item.text, bold: true, font: FONT, size: 26 })] })];
    case "subheading":
      return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: item.text, bold: true, font: FONT, size: SIZE })] })];
    case "numbered": {
      const indent = Math.max(0, item.depth - 2) * 0.7 * TWIP;
      return [
        new Paragraph({
          spacing: { after: 100 },
          indent: { left: indent + 0.7 * TWIP, hanging: 0.7 * TWIP },
          tabStops: [{ type: "left", position: indent + 0.7 * TWIP }],
          children: [new TextRun({ text: `${item.number}\t`, bold: item.depth === 1, font: FONT, size: SIZE }), ...runs(item.text, { bold: item.depth === 1 })],
        }),
      ];
    }
    case "bullet":
      return [new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs(item.text) })];
    case "table":
      return [table(item.rows, wide), new Paragraph({ children: [] })];
    case "sign":
      return [sign(item.who, item.how)];
    case "contents":
      return [
        new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text: "CONTENTS", bold: true, font: FONT, size: 22 })] }),
        ...item.clauses.map((clause) => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: clause, font: FONT, size: 18 })] })),
        new Paragraph({ children: [new PageBreak()] }),
      ];
    case "paragraph":
      return [new Paragraph({ spacing: { after: 120 }, children: runs(item.text) })];
  }
}

/** The document in parts, as the page has them: before the first schedule, then each schedule. */
function parts(blocks: AgreementBlock[]) {
  const out: { blocks: AgreementBlock[]; wide: boolean }[] = [{ blocks: [], wide: false }];
  for (const item of blocks) {
    if (item.kind === "schedule") out.push({ blocks: [], wide: false });
    const part = out.at(-1)!;
    part.blocks.push(item);
    if (item.kind === "table" && (item.rows[0]?.length ?? 0) >= WIDE_TABLE) part.wide = true;
  }
  return out.filter((part) => part.blocks.length > 0);
}

/** The filled agreement's text as a .docx file. */
export async function agreementDocx(text: string, title: string) {
  const sections: ISectionOptions[] = [];
  let current: { wide: boolean; children: (Paragraph | Table)[] } | null = null;
  for (const part of parts(readAgreement(text))) {
    // Portrait parts run on in one section; a wide schedule gets a landscape section of its own, and so does what follows it.
    const opens = !current || part.wide || current.wide;
    if (opens) {
      current = { wide: part.wide, children: [] };
      sections.push({
        properties: {
          page: {
            size: { orientation: part.wide ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: TWIP, bottom: TWIP, left: TWIP, right: TWIP },
          },
        },
        children: current.children,
      });
    }
    part.blocks.forEach((item, i) => current!.children.push(...block(item, part.wide, opens && i === 0)));
  }
  const doc = new Document({
    title,
    creator: "We Lodge",
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections,
  });
  return Packer.toBlob(doc);
}

import JSZip from "jszip";

import type { WordUnit } from "~/lib/agreement-redlines";

/**
 * A returned Word file (.docx) read into paragraphs and table rows, each as it
 * was before their tracked changes and with them taken, with their comments
 * (doc §4.11). Runs in the browser: the file never leaves the person's computer.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const local = (node: Node) => (node as Element).localName;

/** A paragraph's text twice — without their insertions (as it was) and without their deletions (as they want it) — and the comments in it. */
function paragraph(p: Element) {
  let original = "";
  let accepted = "";
  const comments: string[] = [];
  const walk = (node: Node, inserted: boolean, deleted: boolean) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const name = local(child);
      if (name === "pPr" || name === "rPr") continue;
      if (name === "ins" || name === "moveTo") walk(child, true, deleted);
      else if (name === "del" || name === "moveFrom") walk(child, inserted, true);
      else if (name === "t" || name === "delText") {
        const text = child.textContent ?? "";
        if (!inserted) original += text;
        if (!deleted) accepted += text;
      } else if (name === "tab" || name === "br" || name === "cr") {
        const text = name === "tab" ? "\t" : " ";
        if (!inserted) original += text;
        if (!deleted) accepted += text;
      } else if (name === "commentReference") {
        const id = (child as Element).getAttributeNS(W, "id");
        if (id) comments.push(id);
      } else walk(child, inserted, deleted);
    }
  };
  walk(p, false, false);
  return { original, accepted, comments };
}

export async function readWordFile(file: File | Blob): Promise<WordUnit[]> {
  const zip = await JSZip.loadAsync(file);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("This is not a Word (.docx) file.");
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
  const doc = parse(documentXml);

  const commentText = new Map<string, { author: string; text: string }>();
  const commentsXml = await zip.file("word/comments.xml")?.async("string");
  if (commentsXml) {
    for (const comment of Array.from(parse(commentsXml).getElementsByTagNameNS(W, "comment"))) {
      const text = Array.from(comment.getElementsByTagNameNS(W, "p"))
        .map((p) => paragraph(p).accepted.trim())
        .filter(Boolean)
        .join("\n");
      commentText.set(comment.getAttributeNS(W, "id") ?? "", { author: comment.getAttributeNS(W, "author") ?? "", text });
    }
  }
  const named = (ids: string[]) => ids.map((id) => commentText.get(id)).filter((c): c is { author: string; text: string } => Boolean(c?.text));

  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("This Word file has no text.");
  const units: WordUnit[] = [];
  const visit = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const name = child.localName;
      if (name === "p") {
        const read = paragraph(child);
        units.push({ original: [[read.original]], accepted: [[read.accepted]], table: false, comments: named(read.comments) });
      } else if (name === "tbl") {
        for (const row of Array.from(child.children).filter((c) => c.localName === "tr")) {
          const cells = Array.from(row.children).filter((c) => c.localName === "tc");
          const read = cells.map((cell) => Array.from(cell.getElementsByTagNameNS(W, "p")).map(paragraph));
          units.push({
            original: read.map((cell) => cell.map((p) => p.original)),
            accepted: read.map((cell) => cell.map((p) => p.accepted)),
            table: true,
            comments: named(read.flatMap((cell) => cell.flatMap((p) => p.comments))),
          });
        }
      } else if (name === "sdt" || name === "customXml" || name === "sdtContent") visit(child);
    }
  };
  visit(body);
  return units;
}

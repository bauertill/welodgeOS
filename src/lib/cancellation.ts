import { percent } from "~/lib/finance";
import { formatDate } from "~/lib/format";

/**
 * One cancellation term of a quotation or an offer, in a few words, as the
 * lists show it (doc §3.10, §4.11): a fee from a date, a share that may go by
 * a date, a number of rooms that may be cancelled by a date — free or for a
 * fee — or a term in words with no date.
 */
export type CutTerm = {
  kind: string;
  cutoffOn: Date | null;
  percentBasisPoints: number | null;
  feeBasisPoints: number | null;
  rooms: number | null;
  roomType: string | null;
  remarks: string | null;
};

export function cutSummary(cut: CutTerm) {
  const words = cut.remarks?.trim() ? ` — ${cut.remarks.trim()}` : "";
  if (!cut.cutoffOn) return cut.remarks?.trim() ?? "";
  if (cut.rooms !== null) {
    const what = `${cut.rooms} ${cut.roomType?.trim() || (cut.rooms === 1 ? "room" : "rooms")}`;
    return `${what} may be cancelled ${cut.feeBasisPoints ? `for ${percent(cut.feeBasisPoints)}` : "free"} until ${formatDate(cut.cutoffOn)}${words}`;
  }
  if (cut.feeBasisPoints !== null) return `${percent(cut.feeBasisPoints)} charged from ${formatDate(cut.cutoffOn)}${words}`;
  const name = cut.kind === "ATTRITION" ? "attrition" : cut.kind === "RELEASE" ? "release" : "other";
  return `${name}${cut.percentBasisPoints !== null ? ` ${percent(cut.percentBasisPoints)}` : ""} until ${formatDate(cut.cutoffOn)}${words}`;
}

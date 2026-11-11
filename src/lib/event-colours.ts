/**
 * A colour per event, so requests for the same event are seen together on the
 * sales board (the owner, 2026-11-11). Given in the order events were made —
 * ids sort that way — so an event keeps its colour when a new one is added.
 */
export type EventColour = { stripe: string; background: string; text: string };

const palette: EventColour[] = [
  { stripe: "#7c4dd8", background: "#f1ebfc", text: "#5a2fb0" }, // violet
  { stripe: "#1d8fa8", background: "#e3f4f8", text: "#11647a" }, // teal
  { stripe: "#d9822b", background: "#fdf0e2", text: "#9a5410" }, // orange
  { stripe: "#2f9e5b", background: "#e5f5eb", text: "#1d6b3c" }, // green
  { stripe: "#d63c7a", background: "#fce8f0", text: "#a3245a" }, // pink
  { stripe: "#3b6fd4", background: "#e8effc", text: "#2450a3" }, // blue
  { stripe: "#b59a12", background: "#faf5dc", text: "#7a6608" }, // ochre
  { stripe: "#8a5a3c", background: "#f4ece6", text: "#6b4329" }, // brown
  { stripe: "#c0392b", background: "#fbe7e5", text: "#922b20" }, // red
  { stripe: "#5b6b7f", background: "#ebeef2", text: "#3e4a59" }, // slate
];

export function eventColours(eventIds: string[]): Map<string, EventColour> {
  const ordered = [...new Set(eventIds)].sort();
  return new Map(ordered.map((id, index) => [id, palette[index % palette.length]!]));
}

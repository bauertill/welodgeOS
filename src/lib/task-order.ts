/**
 * A Kanban column's new order (doc §2.8). `column` is every card in the column
 * in its current order; `shown` is the cards the person sees, in the order
 * they have just put them (a card dragged in from another column included).
 * A card they cannot see stays just after the card it followed — or at the
 * top, if it led — so their reordering never jumps anyone else's cards about.
 */
export function placeInColumn(column: string[], shown: string[]): string[] {
  const visible = new Set(shown);
  const leading: string[] = [];
  const after = new Map<string, string[]>();
  let last: string | null = null;
  for (const id of column) {
    if (visible.has(id)) {
      last = id;
      continue;
    }
    if (last === null) leading.push(id);
    else after.set(last, [...(after.get(last) ?? []), id]);
  }
  const known = new Set(column);
  return [...leading, ...shown.filter((id, i) => shown.indexOf(id) === i && known.has(id)).flatMap((id) => [id, ...(after.get(id) ?? [])])];
}

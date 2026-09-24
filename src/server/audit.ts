import type { Prisma } from "generated/prisma";

/**
 * The general audit trail (doc §4.9): one place that builds a human-readable
 * diff so every write site describes its own fields once — as a list of
 * `{ key, label }` — rather than hand-writing "what changed" prose per
 * mutation.
 */

type FieldDescriptor<T> = { key: keyof T; label: string };

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

const sameValue = (a: unknown, b: unknown) =>
  a === b || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());

/** One line per field that actually differs; `null` if nothing did. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: FieldDescriptor<T>[],
): string | null {
  const lines = fields
    .filter(({ key }) => !sameValue(before[key], after[key]))
    .map(({ key, label }) => `${label}: ${formatValue(before[key])} → ${formatValue(after[key])}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** Writes one `AuditEntry` row unconditionally — for a create/delete, where
 * there's no before/after to diff, just an event to record. */
export function logAudit(
  tx: Prisma.TransactionClient,
  data: {
    actorId: string;
    entity: string;
    entityId: string;
    summary: string;
    changes?: string | null;
  },
) {
  return tx.auditEntry.create({ data });
}

/** Diffs `before`/`after` and writes an `AuditEntry` only if something
 * actually changed — the common case for an "update" mutation. */
export async function logFieldChanges<T extends Record<string, unknown>>(
  tx: Prisma.TransactionClient,
  data: { actorId: string; entity: string; entityId: string; summary: string },
  before: T,
  after: T,
  fields: FieldDescriptor<T>[],
) {
  const changes = diffFields(before, after, fields);
  if (!changes) return;
  await tx.auditEntry.create({ data: { ...data, changes } });
}

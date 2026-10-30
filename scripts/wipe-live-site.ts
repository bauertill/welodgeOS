/**
 * One-off, requested by the owner (Brandon) on 2026-10-30: a fresh start for
 * the live site. Empties every table except what the system needs to work.
 * Lives on the `wipe-live-site` branch only — never merge it.
 *
 * For Till, from a checkout of this branch with `pnpm install` done:
 *
 *   1. Optional but recommended: in Neon, make a branch of welodge-production
 *      named before-wipe-2026-10-30 — a snapshot to come back to.
 *   2. Dry run — counts only, changes nothing:
 *        CLEAR_DATABASE_URL='<live DATABASE_URL>' pnpm exec tsx scripts/wipe-live-site.ts
 *      Check the host it prints is the live database.
 *   3. Wipe:
 *        CLEAR_DATABASE_URL='<live DATABASE_URL>' pnpm exec tsx scripts/wipe-live-site.ts --yes
 *      It prints the time it ran: Neon can restore to just before it.
 *
 * Rehearsed on a copy of a local database (49 tables emptied, 15 kept
 * unchanged). Staging is overwritten from live at 00:00 UTC, so it follows.
 *
 * Kept: team accounts and sign-in (User, Account, Session, VerificationToken,
 * UserPhone), the amenity list, the agreement wording, the task types, the
 * team chat, and the record of database changes (_prisma_migrations).
 * Everything else — events, properties, room-nights, contracts, clients,
 * requests, rate cards, tasks, notifications, history — is emptied.
 *
 * The tables are read from the database itself, so anything not on the keep
 * list is emptied. TRUNCATE without CASCADE: if a kept table pointed at an
 * emptied one, Postgres refuses and nothing changes.
 */
import { PrismaClient } from "generated/prisma";

const url = process.env.CLEAR_DATABASE_URL;
if (!url) throw new Error("Set CLEAR_DATABASE_URL to the database to wipe.");
const write = process.argv.includes("--yes");
const db = new PrismaClient({ datasourceUrl: url });

const KEEP = new Set([
  "_prisma_migrations",
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "UserPhone",
  "Amenity",
  "AgreementTemplate",
  "TaskType",
  "Conversation",
  "ConversationMember",
  "Message",
  "MessageReaction",
  "MessageRevision",
  "CustomEmoji",
]);

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function tableCounts(tables: string[], client: Pick<PrismaClient, "$queryRawUnsafe"> = db) {
  const out: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await client.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(table)}`);
    out[table] = row!.n;
  }
  return out;
}

async function main() {
  const host = new URL(url!).host;
  const [{ now }] = await db.$queryRawUnsafe<{ now: Date }[]>(`SELECT now()`);
  console.log(`Database: ${host}   ${write ? "WIPING" : "dry run — nothing is changed"}   at ${now.toISOString()}`);

  const tables = (
    await db.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
    )
  ).map((row) => row.table_name);
  const kept = tables.filter((table) => KEEP.has(table));
  const wiped = tables.filter((table) => !KEEP.has(table));

  const keptBefore = await tableCounts(kept);
  const wipedBefore = await tableCounts(wiped);
  console.log("\nKept, as they are:");
  for (const table of kept) console.log(`  ${table.padEnd(28)} ${keptBefore[table]}`);
  console.log("\nTo be emptied:");
  for (const table of wiped) console.log(`  ${table.padEnd(28)} ${wipedBefore[table]}`);
  if (!write) return;

  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE ${wiped.map(q).join(", ")} RESTRICT`);
      const keptAfter = await tableCounts(kept, tx);
      for (const table of kept) {
        if (keptAfter[table] !== keptBefore[table]) throw new Error(`${table} changed (${keptBefore[table]} → ${keptAfter[table]}) — rolled back.`);
      }
      const left = Object.entries(await tableCounts(wiped, tx)).filter(([, n]) => n > 0);
      if (left.length) throw new Error(`Not empty: ${left.map(([t, n]) => `${t} ${n}`).join(", ")} — rolled back.`);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  console.log(`\nDone. ${wiped.length} tables emptied; ${kept.length} kept unchanged.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());

import type { PrismaClient } from "generated/prisma";

import { dayKey, today } from "~/lib/dates";
import { usdRatesOn } from "~/server/exchange-rates";

/**
 * A contract in another currency than dollars has its rate to the US dollar
 * locked on the day it was signed (the owner, 2026-11-19, doc §7), so a margin
 * on it stops moving with the market from then on.
 *
 * Locked here rather than in each of the places a contract is made or signed
 * (by hand, from a quotation, from an offer, on an addendum): whenever
 * contracts are read for their money, any signed one whose lock is missing —
 * or was taken for another signing date or currency — is locked now, at the
 * European Central Bank's rate *for its signing date*, not today's. A signing
 * date still ahead, or a rate that cannot be fetched, leaves it unlocked until
 * the next read; nothing is guessed.
 */
export async function lockContractRates(db: PrismaClient, ids?: string[]) {
  if (ids && ids.length === 0) return;
  // A lock no longer due — unsigned again, or now in dollars — is let go.
  await db.contract.updateMany({
    where: { ...(ids && { id: { in: ids } }), lockedRateMicros: { not: null }, OR: [{ signedOn: null }, { currency: null }, { currency: "USD" }] },
    data: { lockedRateMicros: null, lockedRateCurrency: null, lockedRateFor: null, lockedRateOn: null },
  });
  const candidates = await db.contract.findMany({
    where: {
      ...(ids && { id: { in: ids } }),
      signedOn: { not: null, lte: today() },
      currency: { not: null },
      NOT: { currency: "USD" },
    },
    select: { id: true, signedOn: true, currency: true, lockedRateFor: true, lockedRateCurrency: true, lockedRateMicros: true },
  });
  for (const contract of candidates) {
    const day = dayKey(contract.signedOn!);
    if (contract.lockedRateMicros !== null && contract.lockedRateCurrency === contract.currency && contract.lockedRateFor && dayKey(contract.lockedRateFor) === day) continue;
    const rates = await usdRatesOn(day);
    // The rates cannot be fetched just now: try again on the next read, rather
    // than wait on each contract in turn.
    if (!rates) return;
    const perUsd = rates.perUsd[contract.currency!];
    if (!perUsd) continue;
    await db.contract.update({
      where: { id: contract.id },
      data: {
        lockedRateMicros: Math.round(perUsd * 1_000_000),
        lockedRateCurrency: contract.currency,
        lockedRateFor: contract.signedOn,
        lockedRateOn: new Date(`${rates.date}T00:00:00Z`),
      },
    });
  }
}

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { usdRates } from "~/server/exchange-rates";

/** Today's rates to the US dollar, for the "≈ US$" beside other currencies (doc §4.5). */
export const exchangeRouter = createTRPCRouter({
  usd: protectedProcedure.query(() => usdRates()),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { storedLink } from "~/lib/file-link";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { STORED_FILE_PREFIX, storedFile } from "~/server/files";

/**
 * Files uploaded for a record's document field (doc §2.8): the browser puts
 * the file in the store, then records it here and gets the address the field
 * keeps.
 */
export const filesRouter = createTRPCRouter({
  record: protectedProcedure
    .input(z.object({ pathname: z.string().max(1000), name: z.string().trim().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      if (!input.pathname.startsWith(STORED_FILE_PREFIX)) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is not an upload." });
      const stored = await storedFile(input.pathname);
      if (!stored) throw new TRPCError({ code: "BAD_REQUEST", message: "The file did not arrive — try uploading it again." });
      const file = await ctx.db.storedFile.upsert({
        where: { pathname: input.pathname },
        update: {},
        create: { pathname: input.pathname, name: input.name, contentType: stored.contentType || null, size: stored.size, uploadedById: ctx.session.user.id },
      });
      return { id: file.id, name: file.name, url: storedLink(file.id, file.name) };
    }),
});

import { Fragment } from "react";

/** How a mention is written into an update's body at post time — see the
 * `Update` model in schema.prisma. Not a link to a live user record: it is
 * just the name as it was typed, kept forever like the rest of the post. */
export const MENTION_PATTERN = /@\[([^\]]+)\]/g;

/**
 * The one place that turns a stored update body into markup — so a mention
 * renders the same way everywhere it appears (doc §2.6).
 */
export function renderUpdateBody(body: string) {
  const parts = body.split(MENTION_PATTERN);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="text-brand-700 font-medium">
        @{part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

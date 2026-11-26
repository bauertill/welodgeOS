/**
 * The general terms at the foot of a rate card (doc §4.11; Ami, 2026-11-26:
 * "general terms at the bottom could be editable — keep the current one as a
 * default, some other templates and a free description"). Empty on the card is
 * the standard line; a template only fills the box, which the team can change.
 */
export const standardGeneralTerms = (currency: string) => `Rates are per room per night, in ${currency}, and subject to availability until confirmed.`;

export const generalTermsTemplates: { label: string; text: (currency: string) => string }[] = [
  { label: "Standard", text: standardGeneralTerms },
  {
    label: "Rate changes with length of stay",
    text: (currency) =>
      `${standardGeneralTerms(currency)} Rates are quoted for the length of stay shown; if the length of stay changes, the rates will change accordingly.`,
  },
  {
    label: "Indicative only",
    text: (currency) =>
      `Rates are per room per night, in ${currency}, indicative only and not a binding offer. They are subject to availability and confirmed only once an agreement is signed.`,
  },
];

/** What the client reads at the foot of the card. */
export const generalTermsText = (terms: string | null | undefined, currency: string) => terms?.trim() || standardGeneralTerms(currency);

/**
 * Who may vouch for a client — the trust guarantee: their rooms are sold and
 * the hotels secured before the agreement comes back signed (doc §4.11). Only
 * Volki for now (the owner, 2026-10-14).
 */
export const TRUST_ADMINS = ["volki@welodge.net"];

export const canTrust = (email: string | null | undefined) => Boolean(email && TRUST_ADMINS.includes(email.trim().toLowerCase()));

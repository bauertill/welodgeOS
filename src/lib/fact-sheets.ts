/**
 * Fact sheets for the newsletter (doc §4.12): the rules for telling which
 * client a reader's email belongs to, kept in one place so the fact sheet's
 * page and the client's page agree.
 */

/** Where the download page lives: /download/{code}. */
export const factSheetPath = (token: string) => `/download/${token}`;

/** The largest PDF that can be uploaded. */
export const MAX_FACT_SHEET_BYTES = 50 * 1024 * 1024;

/**
 * Email providers anyone can sign up to: an address there says nothing about
 * the company, so it is never matched to a client by its domain.
 */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.ch", "hotmail.co.uk", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.ch", "gmx.de", "gmx.net", "gmx.com", "web.de", "bluewin.ch", "sunrise.ch", "hispeed.ch", "orange.fr", "free.fr",
  "t-online.de", "mail.com", "zoho.com", "yandex.com",
]);

export const normalEmail = (email: string) => email.trim().toLowerCase();

/** "eda.admin.ch" for "Philipp@EDA.admin.ch"; null for a personal address or none. */
export function companyDomain(email: string | null | undefined) {
  const domain = normalEmail(email ?? "").split("@")[1];
  return domain && !PERSONAL_DOMAINS.has(domain) ? domain : null;
}

/** "fdfa.ch" for "https://www.fdfa.ch/en/home" — a client's website, as a domain to match on. */
export function websiteDomain(website: string | null | undefined) {
  if (!website?.trim()) return null;
  try {
    const host = new URL(website.includes("://") ? website : `https://${website}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** "2.4 MB" */
export function fileSizeWords(bytes: number | null | undefined) {
  if (!bytes) return null;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

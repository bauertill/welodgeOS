import { lookup } from "dns/promises";
import { isIP } from "net";

import type { PrismaClient } from "generated/prisma";

import { env } from "~/env";
import { logAudit } from "~/server/audit";

/**
 * A property's contact details found on their own (doc §4.11): its phone and
 * website from Google Maps (Places API, New — once it is switched on for our
 * key), then its phone and email from its own website — the details hotels
 * publish for search engines, its phone and email links, and its contact
 * page. Only what is empty is filled in; nothing typed by the team is ever
 * replaced.
 */

type Found = { phone?: string; email?: string; website?: string };
export type FindResult = {
  found: (keyof Found)[];
  from: ("google" | "website")[];
  /** Whether Google Maps answered at all — it refuses until switched on for our key. */
  googleOn: boolean;
};

export async function findContacts(db: PrismaClient, propertyId: string, actorId: string | null): Promise<FindResult> {
  const property = await db.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: { name: true, city: true, latitude: true, longitude: true, phone: true, website: true, generalEmail: true },
  });
  const result: FindResult = { found: [], from: [], googleOn: false };
  const fill: Found = {};

  if (!property.phone || !property.website) {
    const google = await fromGoogle(property);
    if (google) {
      result.googleOn = true;
      if (!property.phone && google.phone) fill.phone = google.phone;
      if (!property.website && google.website) fill.website = google.website;
      if (fill.phone ?? fill.website) result.from.push("google");
    }
  }

  const website = property.website ?? fill.website;
  if (website && (!property.phone || !property.generalEmail)) {
    const site = await fromWebsite(website);
    let any = false;
    if (!property.phone && !fill.phone && site.phone) {
      fill.phone = site.phone;
      any = true;
    }
    if (!property.generalEmail && site.email) {
      fill.email = site.email;
      any = true;
    }
    if (any) result.from.push("website");
  }

  if (fill.phone ?? fill.email ?? fill.website) {
    await db.property.update({
      where: { id: propertyId },
      data: { ...(fill.phone && { phone: fill.phone }), ...(fill.email && { generalEmail: fill.email }), ...(fill.website && { website: fill.website }) },
    });
    result.found = (Object.keys(fill) as (keyof Found)[]).filter((key) => fill[key]);
    const words = { phone: "phone", email: "email", website: "website" };
    await logAudit(db, {
      actorId,
      entity: "Property",
      entityId: propertyId,
      summary: `Contact details found on ${result.from.map((source) => (source === "google" ? "Google Maps" : "its website")).join(" and ")}`,
      changes: result.found.map((key) => `${words[key]}: ${fill[key]}`).join("\n"),
    });
  }
  return result;
}

// --- Google Maps -------------------------------------------------------------

async function fromGoogle(property: { name: string; city: string | null; latitude: number | null; longitude: number | null }) {
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.internationalPhoneNumber,places.websiteUri",
    },
    body: JSON.stringify({
      textQuery: [property.name, property.city].filter(Boolean).join(", "),
      pageSize: 1,
      ...(property.latitude !== null && property.longitude !== null
        ? { locationBias: { circle: { center: { latitude: property.latitude, longitude: property.longitude }, radius: 500 } } }
        : {}),
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as { places?: { internationalPhoneNumber?: string; websiteUri?: string }[] } | null;
  const place = data?.places?.[0];
  return { phone: place?.internationalPhoneNumber, website: place?.websiteUri };
}

// --- The property's website ----------------------------------------------------

/** Only public web addresses are read — never one inside a private network. */
async function isPublic(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) return false;
  return addresses.every(({ address }) => {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.)/.test(address)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return false;
    if (/^(::1|fc|fd|fe80)/i.test(address)) return false;
    return true;
  });
}

/** A page's HTML, following up to four redirects — each checked to be public. */
async function page(start: URL) {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    if (!(await isPublic(url))) return null;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WeLodgeOS/1.0; +https://os.welodge.net)", Accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!response) return null;
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) return null;
    const html = await response.text().catch(() => "");
    return { html: html.slice(0, 1_500_000), url };
  }
  return null;
}

const decode = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");

/** A phone number as written, when it looks like one: 7 to 15 digits. */
function phoneOf(value: string | undefined) {
  if (!value) return undefined;
  const text = decode(decodeURIComponent(value.replace(/^tel:/i, ""))).trim();
  const digits = text.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+\d(][\d\s().\-/]+$/.test(text) ? text.replace(/\s+/g, " ") : undefined;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/** Addresses that are not the hotel's own: images, placeholders, website builders. */
const notAnEmail = /\.(png|jpe?g|gif|svg|webp)$|example\.|sentry|wixpress|godaddy|domain\.com|email\.com|yourname|^name@/i;

function read(html: string) {
  const found: { phones: string[]; emails: string[] } = { phones: [], emails: [] };
  // What hotels publish for search engines (schema.org): "telephone" and "email".
  for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const match of block[1]!.matchAll(/"telephone"\s*:\s*"([^"]+)"/g)) {
      const phone = phoneOf(match[1]);
      if (phone) found.phones.push(phone);
    }
    for (const match of block[1]!.matchAll(/"email"\s*:\s*"(?:mailto:)?([^"]+)"/g)) found.emails.push(decode(match[1]!));
  }
  for (const match of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    const phone = phoneOf(match[1]);
    if (phone) found.phones.push(phone);
  }
  for (const match of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) found.emails.push(decode(decodeURIComponent(match[1]!)));
  for (const match of decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")).matchAll(EMAIL)) found.emails.push(match[0]);
  found.emails = found.emails.map((email) => email.trim().toLowerCase()).filter((email) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) && !notAnEmail.test(email));
  return found;
}

/** The best of what was found: an email on the hotel's own domain, and reservations before anything else. */
function best(found: { phones: string[]; emails: string[] }, host: string) {
  const domain = host.replace(/^www\./, "");
  const rank = (email: string) => (email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`) ? 0 : 2) + (/^(reserv|book|stay|sales|info|contact|hello|front)/.test(email) ? 0 : 1);
  const email = [...new Set(found.emails)].sort((a, b) => rank(a) - rank(b))[0];
  return { phone: found.phones[0], email };
}

async function fromWebsite(website: string): Promise<{ phone?: string; email?: string }> {
  let start: URL;
  try {
    start = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return {};
  }
  const home = await page(start);
  if (!home) return {};
  const found = read(home.html);
  let result = best(found, home.url.hostname);
  if (result.phone && result.email) return result;
  // Not all there: its contact page, when the home page links to one on the same site.
  const link = [...home.html.matchAll(/href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)</gi)]
    .map((match) => ({ href: match[1]!, text: match[2]! }))
    .find((anchor) => /contact|kontakt|contacto|contatti|impressum/i.test(`${anchor.href} ${anchor.text}`));
  if (link) {
    let url: URL | null = null;
    try {
      url = new URL(link.href, home.url);
    } catch {}
    if (url && url.hostname === home.url.hostname) {
      const contact = await page(url);
      if (contact) {
        const more = read(contact.html);
        result = best({ phones: [...found.phones, ...more.phones], emails: [...found.emails, ...more.emails] }, home.url.hostname);
      }
    }
  }
  return result;
}

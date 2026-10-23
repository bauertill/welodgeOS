import { env } from "~/env";

/**
 * Away from the live site — staging, a computer — only these are ever emailed
 * (owner, 2026-10-13): staging runs on a copy of the live data, every real
 * address in it, and testing there must not reach anyone else.
 */
export const TEST_ADDRESSES = ["brandon@welodge.net", "ami@welodge.net", "till@welodge.net", "volki@welodge.net", "britz.brandon@gmail.com"];

/**
 * The live site emails nobody until this is switched on (the owner,
 * 2026-10-23: live, but no emails yet). While off, an email there is written
 * to the server log and counts as sent — so switching on later does not send
 * everything that piled up meanwhile.
 */
export const LIVE_EMAILS_ON = false;

/**
 * Sends one email through Resend (doc §2.9). On the live site only once
 * LIVE_EMAILS_ON. Without a key, or off the live
 * site to anyone not in TEST_ADDRESSES, the email is written to the server log
 * instead, and counts as sent.
 */
export async function sendEmail(message: { to: string; subject: string; text: string; html: string }) {
  const live = env.VERCEL_ENV === "production";
  if (live && !LIVE_EMAILS_ON) {
    console.log(`\n[email] Not sent — emails are switched off on the live site: ${message.subject}\n`);
    return true;
  }
  if (!live && !TEST_ADDRESSES.includes(message.to.trim().toLowerCase())) {
    console.log(`\n[email] Not sent — off the live site, ${message.to} is not on the test list: ${message.subject}\n`);
    return true;
  }
  if (!env.RESEND_API_KEY) {
    console.log(`\n[email] To ${message.to}: ${message.subject}\n${message.text}\n`);
    return true;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.NOTIFICATIONS_FROM ?? "We Lodge OS <notifications@os.welodge.net>",
      to: message.to,
      subject: live ? message.subject : `[Test] ${message.subject}`,
      text: message.text,
      html: message.html,
    }),
  }).catch((error: unknown) => {
    console.error("[email] Could not reach Resend:", error);
    return null;
  });
  if (!response?.ok) {
    if (response) console.error("[email] Resend refused:", await response.text());
    return false;
  }
  return true;
}

export const appUrl = () => (env.APP_URL ?? "https://os.welodge.net").replace(/\/$/, "");

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain, readable email: a heading, items each with a link, and a footer. */
export function layoutEmail(heading: string, items: { title: string; body?: string | null; link: string }[]) {
  const base = appUrl();
  const text = [
    heading,
    "",
    ...items.flatMap((item) => [item.title, ...(item.body ? [item.body] : []), `${base}${item.link}`, ""]),
    "—",
    `Change how you get these on your profile: ${base}/team/profile`,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#1d1d1f;max-width:560px">
<p style="font-size:16px;font-weight:600;margin:0 0 16px">${escape(heading)}</p>
${items
  .map(
    (item) => `<div style="border:1px solid #e5e5e5;border-radius:10px;padding:12px 14px;margin:0 0 10px">
<a href="${base}${escape(item.link)}" style="color:#614fc9;font-weight:600;text-decoration:none">${escape(item.title)}</a>
${item.body ? `<p style="margin:6px 0 0;color:#555;white-space:pre-line">${escape(item.body)}</p>` : ""}
</div>`,
  )
  .join("\n")}
<p style="color:#888;font-size:12px;margin-top:20px">We Lodge OS · <a href="${base}/team/profile" style="color:#888">Change how you get these</a></p>
</div>`;
  return { text, html };
}

import { env } from "~/env";

/**
 * Sends one email through Resend (doc §2.9). Without a key — locally, and on
 * staging, which must never email the real addresses its copied data holds —
 * the email is written to the server log instead, and counts as sent.
 */
export async function sendEmail(message: { to: string; subject: string; text: string; html: string }) {
  if (!env.RESEND_API_KEY) {
    console.log(`\n[email] To ${message.to}: ${message.subject}\n${message.text}\n`);
    return true;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.NOTIFICATIONS_FROM ?? "We Lodge OS <notifications@welodge.net>",
      to: message.to,
      subject: message.subject,
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

/**
 * The magic-link email, in We Lodge colours.
 *
 * Deliberately image-free: the logo lives on a host the recipient's mail
 * client may not be able to reach, and remote images are blocked by default
 * in most clients anyway. The wordmark is set in type instead.
 */
export function magicLinkEmail({ url, email }: { url: string; email: string }) {
  const purple = "#AB6CE2";
  const indigo = "#614FC9";
  const ink = "#292929";
  const muted = "#6b6b6b";

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f2f2f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;padding:40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <tr>
              <td>
                <p style="margin:0 0 28px;font-size:20px;font-weight:700;letter-spacing:-0.2px;">
                  <span style="color:${indigo};">we</span><span style="color:${purple};"> lodge</span>
                </p>

                <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:${ink};">
                  Sign in to We Lodge OS
                </h1>
                <p style="margin:0 0 28px;font-size:14px;line-height:22px;color:${muted};">
                  Click the button below to sign in as ${escapeHtml(email)}.
                  This link works once and expires in 15 minutes.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:999px;background:${purple};">
                      <a href="${url}" style="display:inline-block;padding:14px 32px;font-size:14px;color:#ffffff;text-decoration:none;border-radius:999px;">
                        Sign in
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:28px 0 0;font-size:12px;line-height:20px;color:${muted};">
                  If the button does not work, paste this into your browser:<br />
                  <a href="${url}" style="color:${indigo};word-break:break-all;">${url}</a>
                </p>

                <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #e6e6e6;font-size:12px;line-height:20px;color:${muted};">
                  If you did not request this, you can ignore this email — nobody
                  can sign in without the link above.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:20px 0 0;font-size:11px;color:#9a9a9a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            We Lodge AG
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "Sign in to We Lodge OS",
    "",
    `Use this link to sign in as ${email}.`,
    "It works once and expires in 15 minutes.",
    "",
    url,
    "",
    "If you did not request this, you can ignore this email.",
    "",
    "We Lodge AG",
  ].join("\n");

  return { html, text, subject: "Sign in to We Lodge OS" };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

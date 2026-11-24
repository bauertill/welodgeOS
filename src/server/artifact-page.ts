/**
 * Serving an artifact's page (doc §4.13). The page is HTML Claude or a
 * colleague wrote, so it is always served **walled off**: the browser's
 * sandbox gives it an origin of its own, so its scripts cannot read our
 * sign-in, call our API as the viewer, or touch any other page of OS. It can
 * still run its own scripts, load fonts and libraries from the web, open
 * links and print.
 */
export function artifactResponse(html: string) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      // The link's token never travels to sites the page links to.
      "Referrer-Policy": "no-referrer",
      // A new page shows at once.
      "Cache-Control": "private, no-store",
    },
  });
}

export const artifactNotFound = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>We Lodge</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#1e2e5d"><h1 style="font-size:22px">This link is no longer shared</h1><p>Please ask your contact at We Lodge for a new one.</p></body>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } },
  );

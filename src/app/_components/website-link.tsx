/**
 * A website as a short link: its name alone — "wyndhamhotels.com ↗" — not the
 * whole address with its tracking codes, which shows on hover.
 */
export function WebsiteLink({ url }: { url: string }) {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let name = url;
  try {
    name = new URL(href).hostname.replace(/^www\./, "");
  } catch {}
  return (
    <a href={href} target="_blank" rel="noreferrer" title={url} className="text-brand-700 hover:underline">
      {name} ↗
    </a>
  );
}

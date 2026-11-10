import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const metadata = { title: "Allow Claude", robots: { index: false, follow: false } };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/**
 * Allowing Claude to work in WeLodge OS as you (doc §2.10) — the page Claude
 * sends you to when the connector is added. Signed out, you sign in first and
 * come back here. Nothing is granted until you press Allow.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])));
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);

  const clientId = one(params.client_id);
  const redirectUri = one(params.redirect_uri);
  const client = clientId ? await db.mcpClient.findUnique({ where: { id: clientId } }) : null;
  const problem = !client
    ? "This app is not registered with WeLodge OS. Remove the connector in Claude and add it again."
    : !client.redirectUris.includes(redirectUri)
      ? "This app asked to be sent somewhere it did not register."
      : one(params.response_type) !== "code" || !one(params.code_challenge) || one(params.code_challenge_method) !== "S256"
        ? "This app asked in a way WeLodge OS does not accept (it must use a code with PKCE)."
        : null;

  if (problem) {
    return (
      <div className="mx-auto max-w-md py-16">
        {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
        <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mb-8 h-7 w-auto" />
        <h1 className="text-ink-900 text-xl font-semibold">Claude could not be connected</h1>
        <p className="text-ink-700 mt-2 text-sm font-light">{problem}</p>
      </div>
    );
  }

  const cancel = new URL(redirectUri);
  cancel.searchParams.set("error", "access_denied");
  if (one(params.state)) cancel.searchParams.set("state", one(params.state));

  return (
    <div className="mx-auto max-w-md py-16">
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
      <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mb-8 h-7 w-auto" />
      <h1 className="text-ink-900 text-xl font-semibold">Allow Claude to work in WeLodge OS as you?</h1>
      <p className="text-ink-700 mt-2 text-sm font-light">
        Signed in as <span className="font-medium">{session.user.name ?? session.user.email}</span>
        {client!.name ? ` · ${client!.name}` : ""}.
      </p>
      <div className="mt-5 space-y-3 rounded-xl bg-white px-5 py-4 text-sm font-light shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <p>
          <span className="font-medium">Claude will be able to</span> look up what you can see — sales requests, clients, events, properties, the stock
          sheet&rsquo;s position, tasks — and make everyday changes in your name: register a request, fill in its details, move its stage, hand it over, add
          a contact, an update or a task.
        </p>
        <p>
          <span className="font-medium">It will not</span> delete anything, buy, block or sell rooms, or make contracts.
        </p>
        <p className="text-ink-500 text-xs">Every change is written to the history as made by you, via Claude. Disconnect any time on My profile.</p>
      </div>
      <form method="post" action="/api/oauth/authorize" className="mt-6 flex items-center gap-3">
        {["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"].map((key) => (
          <input key={key} type="hidden" name={key} value={one(params[key])} />
        ))}
        <button type="submit" className="bg-brand-400 hover:bg-brand-500 rounded-full px-5 py-2.5 text-[13px] font-medium text-white">
          Allow
        </button>
        <a href={cancel.toString()} className="text-ink-500 text-[13px] hover:underline">
          Cancel
        </a>
      </form>
    </div>
  );
}

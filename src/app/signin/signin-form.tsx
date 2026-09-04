"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function GoogleButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <button
      type="button"
      onClick={() => void signIn("google", { callbackUrl })}
      className="border-ink-200 hover:border-brand-400 hover:bg-brand-50/50 flex w-full items-center justify-center gap-3 rounded-full border bg-white px-7 py-3.5 text-[13px] transition-colors"
    >
      <GoogleMark />
      Continue with Google
    </button>
  );
}

/**
 * Development only — the page renders this solely when NODE_ENV is
 * development, and the route behind it 404s otherwise.
 */
export function DevLoginButton({
  email,
  callbackUrl,
}: {
  email: string;
  callbackUrl: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          fetch("/api/dev-login", { method: "POST" })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              // A full load rather than a router push, so every server
              // component re-reads the new session cookie.
              window.location.href = callbackUrl;
            })
            .catch(() => {
              setError("Development sign-in failed. Is the database running?");
              setPending(false);
            });
        }}
        className="border-ink-200 text-ink-700 hover:border-brand-400 hover:bg-brand-50/50 w-full rounded-full border border-dashed bg-white px-7 py-3.5 text-[13px] font-light transition-colors disabled:opacity-60"
      >
        {pending ? "Signing in…" : `Log in as ${email}`}
      </button>
      <p className="text-ink-500 text-center text-[11px] font-light">
        Development only — no password, no email. Not available in a production
        build.
      </p>
      {error && (
        <p className="text-center text-[11px] text-[#c03654]">{error}</p>
      )}
    </div>
  );
}

export function MagicLinkForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        void signIn("resend", { email, callbackUrl });
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor="email" className="sr-only">
        Work email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@welodge.net"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="border-ink-200 focus:border-brand-400 focus:ring-brand-400/30 rounded-full border bg-white px-5 py-3.5 text-[13px] outline-none focus:ring-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-brand-400 hover:bg-brand-500 rounded-full px-7 py-3.5 text-[13px] font-light text-white transition-colors disabled:opacity-60"
      >
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4.1H24v7.5h11.9c-.2 2-1.5 5-4.4 7l6.7 5.2c4-3.7 6.9-9.1 6.9-15.6z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.8 0 10.7-1.9 14.2-5.2l-6.7-5.2c-1.8 1.3-4.2 2.2-7.5 2.2-5.7 0-10.6-3.8-12.3-9l-7 5.4C8.2 41.1 15.5 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.7 28.8c-.5-1.3-.7-2.8-.7-4.3s.3-3 .7-4.3l-7-5.4C3.7 17.6 3 20.7 3 24s.7 6.4 1.7 9.2l7-4.4z"
      />
      <path
        fill="#EA4335"
        d="M24 10.5c4 0 6.8 1.7 8.4 3.2l6-5.9C34.7 4.4 29.8 2 24 2 15.5 2 8.2 6.9 4.7 14.8l7 5.4c1.7-5.2 6.6-9.7 12.3-9.7z"
      />
    </svg>
  );
}

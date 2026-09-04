import { redirect } from "next/navigation";

import {
  DevLoginButton,
  GoogleButton,
  MagicLinkForm,
} from "~/app/signin/signin-form";
import { DEV_USER } from "~/server/auth/dev-user";
import { auth, providers } from "~/server/auth";

export const metadata = { title: "Sign in" };

const errorMessages: Record<string, string> = {
  OAuthAccountNotLinked:
    "That email is already registered with a different sign-in method. Use the method you signed up with.",
  Verification: "That sign-in link has expired or was already used.",
  AccessDenied: "That account is not permitted to sign in.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const params = await searchParams;
  const callbackUrl =
    typeof params.callbackUrl === "string" ? params.callbackUrl : "/";
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-ink-900 text-2xl font-semibold">Sign in</h1>
      <p className="text-ink-500 mt-1 text-sm font-light">
        Access to We Lodge OS is limited to We Lodge staff and partners.
      </p>

      {error && (
        <p className="mt-6 rounded-xl border border-[#db4b68]/30 bg-[#db4b68]/10 px-4 py-3 text-sm text-[#c03654]">
          {errorMessages[error] ?? "Something went wrong. Please try again."}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-5">
        {providers.google && <GoogleButton callbackUrl={callbackUrl} />}

        {providers.google && providers.email && (
          <div className="flex items-center gap-3">
            <span className="bg-ink-200 h-px flex-1" />
            <span className="text-ink-500 text-[11px] tracking-wider uppercase">
              or
            </span>
            <span className="bg-ink-200 h-px flex-1" />
          </div>
        )}

        {providers.email && <MagicLinkForm callbackUrl={callbackUrl} />}

        {providers.emailGoesToConsole && (
          <p className="border-ink-200 text-ink-500 rounded-xl border border-dashed px-4 py-3 text-[11px] font-light">
            <code>AUTH_RESEND_KEY</code> is not set, so no email is sent — the
            sign-in link is printed in the terminal running{" "}
            <code>npm run dev</code>.
          </p>
        )}

        {providers.devLogin && (
          <>
            <div className="flex items-center gap-3">
              <span className="bg-ink-200 h-px flex-1" />
              <span className="text-ink-500 text-[11px] tracking-wider uppercase">
                Development
              </span>
              <span className="bg-ink-200 h-px flex-1" />
            </div>
            <DevLoginButton
              email={DEV_USER.email}
              callbackUrl={callbackUrl}
            />
          </>
        )}

        {!providers.google && !providers.email && !providers.devLogin && (
          <p className="text-ink-500 text-sm font-light">
            No sign-in method is configured. Set <code>AUTH_GOOGLE_ID</code> and{" "}
            <code>AUTH_GOOGLE_SECRET</code>, or <code>AUTH_RESEND_KEY</code> and{" "}
            <code>EMAIL_FROM</code>.
          </p>
        )}
      </div>
    </div>
  );
}

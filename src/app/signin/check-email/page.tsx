import Link from "next/link";

export const metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <div className="mx-auto max-w-sm py-12 text-center">
      <div className="bg-brand-50 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="text-brand-700"
          aria-hidden="true"
        >
          <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </div>

      <h1 className="text-ink-900 mt-5 text-2xl font-semibold">
        Check your email
      </h1>
      <p className="text-ink-500 mt-2 text-sm font-light">
        We sent you a sign-in link. It is valid for 15 minutes and can be used
        once.
      </p>

      <Link
        href="/signin"
        className="text-brand-700 hover:text-brand-400 mt-6 inline-block text-[13px]"
      >
        ← Back to sign in
      </Link>
    </div>
  );
}

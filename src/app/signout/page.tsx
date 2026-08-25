import { redirect } from "next/navigation";

import { auth, signOut } from "~/server/auth";

export const metadata = { title: "Sign out" };

export default async function SignOutPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="mx-auto max-w-sm py-12 text-center">
      <h1 className="text-ink-900 text-2xl font-semibold">Sign out</h1>
      <p className="text-ink-500 mt-2 text-sm font-light">
        You are signed in as {session.user.email}.
      </p>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
        className="mt-8"
      >
        <button
          type="submit"
          className="bg-brand-400 hover:bg-brand-500 w-full rounded-full px-7 py-3.5 text-[13px] font-light text-white transition-colors"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

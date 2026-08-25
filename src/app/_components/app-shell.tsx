import Image from "next/image";
import Link from "next/link";

import { HeaderAuth } from "~/app/_components/header-auth";
import { Nav } from "~/app/_components/nav";
import { auth } from "~/server/auth";

/**
 * The persistent chrome: charcoal sidebar carrying the We Lodge logo and
 * navigation, with the page rendered on the light neutral canvas beside it.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex min-h-screen">
      <aside className="bg-ink-700 sticky top-0 hidden h-screen w-60 shrink-0 flex-col py-6 md:flex">
        {/* The brand mark sits on a white card, as it does on welodge.net. */}
        <Link href="/" className="mb-8 block px-5">
          <span className="inline-flex rounded-lg bg-white px-3 py-2.5">
            <Image
              src="/welodge-logo.png"
              alt="We Lodge"
              width={758}
              height={304}
              priority
              className="h-6 w-auto"
            />
          </span>
        </Link>

        <Nav />

        <div className="mt-auto px-6 pt-6">
          <p className="text-[11px] tracking-wide text-white/40 uppercase">
            We Lodge AG
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-ink-700 flex h-14 items-center justify-between gap-4 px-6 md:h-16">
          <Link href="/" className="md:hidden">
            <span className="inline-flex rounded-lg bg-white px-3 py-2">
              <Image
                src="/welodge-logo.png"
                alt="We Lodge"
                width={758}
                height={304}
                className="h-5 w-auto"
              />
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <HeaderAuth email={session?.user?.name ?? session?.user?.email ?? null} />
          </div>
        </header>

        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

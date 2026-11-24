import { RoomingList } from "~/app/_components/rooming-list";
import { api } from "~/trpc/server";

/**
 * The client's rooming list, from its link — no sign-in (doc §6.9). Their
 * rooms and dates are fixed as per the contract; they put in their people.
 */
export const metadata = { title: "Rooming list — We Lodge", robots: { index: false, follow: false } };

export default async function SharedRoomingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const list = await api.rooming.shared({ token }).catch(() => null);
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <header>
        <p className="text-brand-700 text-xs font-medium tracking-wide uppercase">We Lodge · Rooming list</p>
        {list?.event && (
          <>
            <h1 className="text-ink-900 mt-1 text-3xl font-medium">{list.event.name}</h1>
            <p className="text-ink-500 mt-1 text-[15px] font-light">Who stays where, for {list.client}. Your changes reach our team straight away; come back to this link any time.</p>
          </>
        )}
      </header>
      <RoomingList token={token} />
    </div>
  );
}

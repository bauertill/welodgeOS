import { StayPage } from "~/app/_components/stay-page";
import { api } from "~/trpc/server";

/**
 * The client's property information page, from its link — no sign-in (doc
 * §6.8). The link's code is the only key; it shows what guests need to know,
 * never prices or our notes.
 */
export const metadata = { title: "Property information — We Lodge", robots: { index: false, follow: false } };

export default async function SharedStayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const stay = await api.guestInfo.shared({ token }).catch(() => null);
  if (!stay) {
    return (
      <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-white p-8 text-center">
        <h1 className="text-ink-900 text-lg font-medium">This page is not shared any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for the latest link.</p>
      </div>
    );
  }
  return <StayPage stay={stay} />;
}

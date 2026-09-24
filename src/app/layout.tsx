import "~/styles/globals.css";

import { type Metadata } from "next";
import { Poppins } from "next/font/google";

import { AppShell } from "~/app/_components/app-shell";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: {
    default: "We Lodge OS",
    template: "%s · We Lodge OS",
  },
  description: "Accommodation and booking management for We Lodge AG.",
  // The brand mark alone — the wordmark is unreadable at this size — on the
  // white card it sits on in the sidebar. The .ico carries separately drawn
  // 16, 32 and 48px versions; browsers pick the one that fits.
  icons: [
    { rel: "icon", url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
    { rel: "icon", url: "/icon.png", type: "image/png", sizes: "512x512" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon.png", sizes: "180x180" },
  ],
};

// Poppins is the We Lodge brand face; the site uses light through bold.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className="font-sans">
        <TRPCReactProvider>
          <AppShell>{children}</AppShell>
        </TRPCReactProvider>
      </body>
    </html>
  );
}

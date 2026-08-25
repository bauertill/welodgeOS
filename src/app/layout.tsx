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
  icons: [{ rel: "icon", url: "/favicon.ico" }],
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

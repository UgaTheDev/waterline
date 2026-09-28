import { BRAND, TAGLINE } from "@/lib/brand";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import Header from "@/components/Header";
import OfflineBanner from "@/components/OfflineBanner";
import RegisterSw from "@/components/RegisterSw";
import { themeBootScript } from "@/lib/theme";
import { USE_MOCK } from "@/lib/api";
import "./globals.css";

const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: `${BRAND} · street-level flood depth`,
  description: `${TAGLINE} Flood depth from photos, routing that respects your vehicle.`,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070b10" },
    { media: "(prefers-color-scheme: light)", color: "#f3f0e8" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${plex.variable} ${plexMono.variable} ${serif.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        {USE_MOCK && (
          <div role="status" className="bg-warn-soft text-warn text-center text-xs py-1.5 px-4 font-medium">
            Sample data for UI development. These are not real flood reports.
          </div>
        )}
        <OfflineBanner />
        <RegisterSw />
        <Header />
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import InstallBanner from "./components/InstallBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#1a1a2e",
};

export const metadata: Metadata = {
  title: "MillionStore Haiti",
  description: "Achte òdinatè, telefòn ak akseswa teknoloji ann Ayiti. Livrezon rapid toupatou.",
  verification: {
    google: "q0Gz-4UAT2WjLrXEq_BrFJkher876tD71-5zVG5bnEI",
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MillionStore",
  },
  openGraph: {
    title: "MillionStore Haiti",
    description: "Achte òdinatè, telefòn ak akseswa teknoloji ann Ayiti. Livrezon rapid toupatou.",
    url: "https://millionstorehaiti.vercel.app",
    siteName: "MillionStore Haiti",
    images: [{ url: "https://millionstorehaiti.vercel.app/og-image.png", width: 1200, height: 630, alt: "MillionStore Haiti" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MillionStore" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="min-h-full flex flex-col">
        <InstallBanner />
        {children}
        <script dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js');
              });
            }

            window.deferredInstallPrompt = null;
            window.addEventListener('beforeinstallprompt', function(e) {
              e.preventDefault();
              window.deferredInstallPrompt = e;
              window.dispatchEvent(new Event('ms-install-available'));
            });
          `
        }} />
      </body>
    </html>
  );
}
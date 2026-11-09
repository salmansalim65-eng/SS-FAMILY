import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppLock } from "@/components/app-lock";
import { ThemeProvider } from "@/components/theme-provider";
import { LOCK_BOOT_SCRIPT } from "@/lib/app-lock";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "SS Dashboard",
  description: "Home screen for all my projects",
  appleWebApp: { title: "SS Dashboard", capable: true, statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1017" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCK_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <ThemeProvider>
          {children}
          <AppLock />
        </ThemeProvider>
      </body>
    </html>
  );
}

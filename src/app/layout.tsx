import type { Metadata, Viewport } from "next";
import { todoPreview } from "@/lib/kanban/public-preview";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Контур | Проекты, задачи и агенты",
  description: todoPreview.description,
  metadataBase: new URL(todoPreview.url),
  twitter: { card: "summary_large_image", title: todoPreview.title, description: todoPreview.description, images: [todoPreview.image] },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico?v=20261031", sizes: "any", type: "image/x-icon" },
      { url: "/icon-192.png?v=20261031", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png?v=20261031", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: todoPreview.title,
    description: todoPreview.description,
    type: "website",
    url: todoPreview.url,
    images: [{ url: todoPreview.image, width: 1200, height: 630, alt: todoPreview.title }],
  },
};

export const viewport: Viewport = { colorScheme: "dark light", themeColor: "#09080d" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          storageKey="kontur-theme"
          defaultTheme="dark"
          enableSystem={false}
          enableColorScheme={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

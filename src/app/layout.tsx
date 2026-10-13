import type { Metadata } from "next";
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
  title: todoPreview.title,
  description: todoPreview.description,
  metadataBase: new URL(todoPreview.url),
  twitter: { card: "summary_large_image", title: todoPreview.title, description: todoPreview.description, images: [todoPreview.image] },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: todoPreview.title,
    description: todoPreview.description,
    type: "website",
    url: todoPreview.url,
    images: [{ url: todoPreview.image, width: 1200, height: 630, alt: todoPreview.title }],
  },
};

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
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

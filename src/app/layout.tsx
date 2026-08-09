import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Клуб Дискуссий — дискуссии на уровне научных аргументов",
  description: "Матричное пространство для качественных дискуссий с ИИ-модератором, который следит за логикой аргументации и ловит когнитивные искажения.",
  icons: {
    icon: "https://chat.bezrabotnyi.com/favicon.ico",
  },
  openGraph: {
    title: "Клуб Дискуссий",
    description: "Дискуссии на уровне научных аргументов с ИИ-модератором",
    type: "website",
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
        {children}
      </body>
    </html>
  );
}